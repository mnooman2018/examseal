/**
 * Local end-to-end test for `ops seed`. Never touches MST Testnet.
 *
 *   1. start a local chain:   pnpm --filter contracts exec hardhat node
 *   2. in another terminal:   pnpm --filter examseal-ops run e2e:local
 *
 * Deploys a fresh ExamSealRegistry from the compiled artifact, seeds 20 centres with
 * Hardhat's public dev accounts, then walks the full lifecycle against the contract:
 * early release rejected → 2/5 still locked → 3/5 authorizes → every centre decrypts
 * from on-chain data only → spare 4th piece accepted → fingerprints reveal.
 * Secret files go to a temp directory, not demo-data/secrets.
 */
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type CentreCode,
  buildEvidenceReport,
  canonicalJson,
  decide,
  evidenceHash,
  identifyQuestions,
  reasonHash,
  scoreCentres,
  syntheticExtraction,
  type Hex,
  decodeFingerprint,
  fromHexBytes,
  recoverVariant,
  renderVariantHtml,
  validateMasterPaper,
} from "examseal-core";
import {
  type Abi,
  BaseError,
  ContractFunctionRevertedError,
  type PublicClient,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { registryAbi } from "../src/chain";
import { EXAMPLE_PAPER, MASTER_PAPER, ROOT } from "../src/env";
import { release as opsRelease } from "../src/release";
import { seed } from "../src/seed";

const RPC = process.env.E2E_RPC ?? "http://127.0.0.1:8545";
// Hardhat's well-known public development mnemonic. These accounts hold no real value.
const DEV_MNEMONIC = "test test test test test test test test test test test junk";
const dev = (i: number) => mnemonicToAccount(DEV_MNEMONIC, { addressIndex: i });

let passed = 0;
function check(cond: unknown, what: string): void {
  if (!cond) throw new Error(`FAIL: ${what}`);
  passed++;
  console.log(`  ✓ ${what}`);
}
const readJsonFile = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

async function main() {
  const probe = createPublicClient({ transport: http(RPC) });
  const chainId = await probe.getChainId().catch(() => {
    throw new Error(`No local chain at ${RPC}. Start one with: pnpm --filter contracts exec hardhat node`);
  });
  if (chainId === 91562037) throw new Error("E2E_RPC points at MST Testnet; this test is local-only.");
  const chain = defineChain({ id: chainId, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
  const pc = createPublicClient({ chain, transport: http(RPC) }) as PublicClient;
  const walletFor = (i: number) => createWalletClient({ account: dev(i), chain, transport: http(RPC) });
  const timeTravel = async (seconds: number) => {
    await pc.request({ method: "evm_increaseTime" as never, params: [seconds] as never });
    await pc.request({ method: "evm_mine" as never, params: [] as never });
  };

  console.log(`Local chain ${chainId} at ${RPC}`);
  const artifact = readJsonFile<{ abi: Abi; bytecode: Hex }>(
    path.join(ROOT, "packages/contracts/artifacts/contracts/ExamSealRegistry.sol/ExamSealRegistry.json"),
  );
  const deployTx = await walletFor(0).deployContract({ abi: artifact.abi, bytecode: artifact.bytecode });
  const registry = (await pc.waitForTransactionReceipt({ hash: deployTx })).contractAddress!;
  console.log(`Deployed ExamSealRegistry at ${registry}\n`);

  // ── seed ───────────────────────────────────────────────────────────────────
  const outRoot = mkdtempSync(path.join(os.tmpdir(), "examseal-e2e-"));
  const custodians = [1, 2, 3, 4, 5].map((i) => dev(i).address);
  const result = await seed(
    { centres: 20, releaseIn: 120, revealAfter: 60, rpc: RPC, contract: registry, outRoot },
    { authority: dev(0), custodians, codebookSeed: new Uint8Array(32).fill(7) },
  );
  if (!result) throw new Error("seed returned nothing");
  const { examId, dir } = result;
  const paperPath = [MASTER_PAPER, EXAMPLE_PAPER].find((p) => {
    try {
      readFileSync(p);
      return true;
    } catch {
      return false;
    }
  })!;
  const master = validateMasterPaper(readJsonFile(paperPath));
  if (!master.ok) throw new Error("master paper invalid");

  console.log("\nChecks:");
  const read = <T>(functionName: string, args: unknown[]) =>
    pc.readContract({ address: registry, abi: registryAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
  type CentreView = { status: number; approvals: number; registeredBlock: bigint; variantCommitment: Hex; encPubKey: Hex; lastEvidenceHash: Hex };

  // secret files
  const custFiles = readdirSync(path.join(dir, "custodians")).sort();
  check(custFiles.length === 5, "5 custodian files written");
  check(readdirSync(path.join(dir, "centres")).length === 20, "20 centre key files written");
  const custodianFile = (i: number) =>
    readJsonFile<{ custodianIndex: number; custodianAddress: string; shares: { centreId: number; sealedShare: Hex }[] }>(
      path.join(dir, "custodians", custFiles.find((f) => f.startsWith(`custodian-${i + 1}-`))!),
    );
  const c0 = custodianFile(0);
  check(c0.custodianIndex === 0 && c0.custodianAddress === custodians[0], "custodian file 1 has index 0 and the right address");
  check(c0.shares.length === 20 && c0.shares.every((s) => (s.sealedShare.length - 2) / 2 === 93), "each custodian file holds 20 sealed pieces of 93 bytes");
  const summary = readJsonFile<{ status: string }>(path.join(dir, "summary.json"));
  check(summary.status === "sealed", "summary.json status is sealed");
  const cands = readJsonFile<{ candidates: { centreId: number; seat: number }[]; seats: number[] }>(path.join(dir, "candidates.secret.json"));
  check(cands.candidates.length === 20 * 30 && cands.seats.length === 30, "seed also wrote candidates.secret.json (20 centres × 30 seats, D9)");

  // on-chain state after seed
  const exam = await read<{ threshold: number; centreCount: number; custodians: readonly string[] }>("getExam", [examId]);
  check(exam.threshold === 3 && exam.centreCount === 20, "exam has threshold 3 and 20 centres on-chain");
  check((await read<readonly number[]>("getCentreIds", [examId])).length === 20, "getCentreIds lists 20 centres");

  // early release must revert the whole tx with ReleaseNotStarted
  const release = async (i: number) => {
    const f = custodianFile(i);
    const hash = await walletFor(i + 1).writeContract({
      address: registry,
      abi: registryAbi,
      functionName: "releaseShares",
      args: [examId, f.shares.map((s) => s.centreId), f.shares.map((s) => s.sealedShare)],
    });
    return pc.waitForTransactionReceipt({ hash });
  };
  let revertName = "";
  try {
    const f = custodianFile(0);
    await pc.simulateContract({
      account: dev(1),
      address: registry,
      abi: registryAbi,
      functionName: "releaseShares",
      args: [examId, f.shares.map((s) => s.centreId), f.shares.map((s) => s.sealedShare)],
    });
  } catch (e) {
    const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    revertName = r instanceof ContractFunctionRevertedError ? (r.data?.errorName ?? "") : "";
  }
  check(revertName === "ReleaseNotStarted", "early release reverts with ReleaseNotStarted");

  const opsOpts = (n: number) => ({ examId, custodian: n, rpc: RPC, contract: registry, secretsRoot: outRoot });
  const errorOf = async (p: Promise<unknown>) => p.then(() => "", (e: Error) => e.message);
  check(/Release opens in \d+s/.test(await errorOf(opsRelease(opsOpts(4), dev(4)))), "ops release refuses before release time (no tx sent)");
  check(/is for 0x/.test(await errorOf(opsRelease(opsOpts(4), dev(5)))), "ops release refuses a key that does not match the custodian file");

  await timeTravel(125);
  await release(0);
  await release(1);
  let c14 = await read<CentreView>("getCentre", [examId, 14]);
  check(c14.approvals === 2 && c14.status === 1, "with 2/5 released, centre 14 is still Sealed");

  await release(2);
  c14 = await read<CentreView>("getCentre", [examId, 14]);
  check(c14.approvals === 3 && c14.status === 2, "3rd release authorizes centre 14 (Released, 3/5)");

  // every centre decrypts from on-chain data + its own key file only
  const codebook = readJsonFile<{ centres: CentreCode[] }>(path.join(dir, "codebook.secret.json"));
  for (let id = 1; id <= 20; id++) {
    const key = readJsonFile<{ x25519PublicKey: Hex; x25519PrivateKey: Hex }>(path.join(dir, "centres", `centre-${id}.centrekey.secret.json`));
    const cv = await read<CentreView>("getCentre", [examId, id]);
    const [, shares] = await read<[readonly string[], readonly Hex[]]>("getShares", [examId, id]);
    const logs = await pc.getContractEvents({
      address: registry,
      abi: registryAbi,
      eventName: "EncryptedVariantPublished",
      args: { examId, centreId: id } as never,
      fromBlock: cv.registeredBlock,
      toBlock: cv.registeredBlock,
    });
    const ciphertext = (logs[0].args as { ciphertext: Hex }).ciphertext;
    if (keccak256(ciphertext) !== cv.variantCommitment) throw new Error(`centre ${id}: commitment mismatch`);
    const r = await recoverVariant({
      sealedPieces: shares.filter((s) => s !== "0x").map((s) => fromHexBytes(s)),
      centreSk: fromHexBytes(key.x25519PrivateKey),
      centrePk: fromHexBytes(key.x25519PublicKey),
      ciphertext: fromHexBytes(ciphertext),
      examId,
      centreId: id,
      threshold: exam.threshold,
    });
    const variant = JSON.parse(new TextDecoder().decode(r.plaintext));
    const expected = readJsonFile(path.join(dir, "variants", `centre-${id}.variant.secret.json`));
    if (canonicalJson(variant) !== canonicalJson(expected)) throw new Error(`centre ${id}: decrypted variant differs`);
    const html = readFileSync(path.join(dir, "variants", `centre-${id}.html`), "utf8");
    if (renderVariantHtml(variant) !== html) throw new Error(`centre ${id}: rendered HTML differs`);
  }
  check(true, "all 20 centres: ciphertext from a single-block log matches the on-chain commitment, 3 pieces decrypt, paper equals the seeded variant");

  // Revoke centre 20 first: ops release must leave it out of the tx.
  const revokeTx = await walletFor(0).writeContract({ address: registry, abi: registryAbi, functionName: "revokeCentre", args: [examId, 20, keccak256("0x01")] });
  await pc.waitForTransactionReceipt({ hash: revokeTx });
  const r4 = await opsRelease(opsOpts(4), dev(4));
  c14 = await read<CentreView>("getCentre", [examId, 14]);
  check(r4.tx && r4.released.length === 19 && c14.approvals === 4, "ops release --custodian 4 releases 19 pieces in one tx (centre 14 at 4/5)");
  check(r4.skipped.length === 1 && r4.skipped[0].centreId === 20 && r4.skipped[0].reason === 1, "ops release leaves revoked centre 20 out of the tx");
  const r5 = await opsRelease(opsOpts(5), dev(5));
  c14 = await read<CentreView>("getCentre", [examId, 14]);
  check(r5.tx && c14.approvals === 5 && c14.status === 2, "ops release --custodian 5 brings centre 14 to 5/5");
  const again = await opsRelease(opsOpts(4), dev(4));
  check(again.tx === null && again.skipped.length === 20, "re-running ops release for custodian 4 sends nothing");

  // fingerprints reveal against the on-chain commitments
  await timeTravel(65);
  const reveal = readJsonFile<{ centres: { centreId: number; fingerprint: Hex; salt: Hex }[] }>(path.join(dir, "reveal.secret.json"));
  const anyone = walletFor(9);
  for (const c of reveal.centres) {
    const hash = await anyone.writeContract({ address: registry, abi: registryAbi, functionName: "revealFingerprint", args: [examId, c.centreId, c.fingerprint, c.salt] });
    const rc = await pc.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`reveal for centre ${c.centreId} failed`);
    const decoded = decodeFingerprint(master.paper, c.centreId, fromHexBytes(c.fingerprint));
    const code = codebook.centres.find((x) => x.centreId === c.centreId);
    if (JSON.stringify(decoded) !== JSON.stringify(code)) throw new Error(`centre ${c.centreId}: fingerprint does not decode to its code`);
  }
  check(true, "all 20 fingerprints reveal on-chain (commitments match) and decode to the codebook");

  // /trace accountability: same matcher + same recordLeak / revokeCentre argument shapes as the page.
  const code14 = codebook.centres.find((c) => c.centreId === 14)!;
  const leak = syntheticExtraction(master.paper, code14, [1, 2, 3, 4, 5, 6, 7, 8]);
  const obs = identifyQuestions(leak, master.paper);
  const scores = scoreCentres(obs, codebook.centres);
  const decision = decide(scores, obs.length);
  check(decision.kind === "MATCH" && decision.centreId === 14, `trace: ${decision.reason}`);
  const report = buildEvidenceReport({
    examId: examId.toString(),
    imageSha256: keccak256("0x00"),
    extraction: leak,
    observations: obs,
    scores,
    decision,
    createdAt: new Date().toISOString(),
  });
  const evidence = evidenceHash(report);
  const authority = walletFor(0);
  const leakTx = await authority.writeContract({
    address: registry,
    abi: registryAbi,
    functionName: "recordLeak",
    args: [examId, 14, evidence, decision.best!.matched, decision.best!.observed],
  });
  await pc.waitForTransactionReceipt({ hash: leakTx });
  c14 = await read<CentreView>("getCentre", [examId, 14]);
  check(c14.lastEvidenceHash === evidence, "recordLeak stores this report's evidence hash for centre 14");
  const revokeTx14 = await authority.writeContract({
    address: registry,
    abi: registryAbi,
    functionName: "revokeCentre",
    args: [examId, 14, reasonHash(`Leak traced to Centre 14. Evidence ${evidence}`)],
  });
  await pc.waitForTransactionReceipt({ hash: revokeTx14 });
  c14 = await read<CentreView>("getCentre", [examId, 14]);
  check(c14.status === 3, "revokeCentre marks centre 14 Compromised");
  let notAuthority = "";
  try {
    await pc.simulateContract({ account: dev(1), address: registry, abi: registryAbi, functionName: "recordLeak", args: [examId, 14, evidence, 1, 1] });
  } catch (e) {
    const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    notAuthority = r instanceof ContractFunctionRevertedError ? (r.data?.errorName ?? "") : "";
  }
  check(notAuthority === "NotAuthority", "recordLeak from a non-authority wallet reverts NotAuthority");

  console.log(`\nPASS: ${passed} checks. Secrets for this local run: ${dir}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
