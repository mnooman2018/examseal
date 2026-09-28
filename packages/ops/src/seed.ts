import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type CentreCode,
  type Hex,
  type MasterPaper,
  type VariantPaper,
  aesGcmEncrypt,
  buildVariant,
  canonicalJson,
  encodeFingerprint,
  fingerprintCommitment,
  generateAesKey,
  generateCentreKeypair,
  generateCodebook,
  paperCommitment,
  renderVariantHtml,
  sealPiece,
  splitKey,
  toHexBytes,
  utf8,
  validateMasterPaper,
  variantAad,
  variantCommitment,
} from "examseal-core";
import { type Address, type Hash, type LocalAccount, getAddress, isAddress, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEFAULT_SEATS, buildCandidates, writeCandidatesFile } from "./candidates";
import { type Conn, chainTime, confirm, connect, jsonStringify, registryAbi, wallet } from "./chain";
import { ROOT, UserError, loadEnv, readJson, rel, resolvePaperPath, secret32, userPath } from "./env";

export const THRESHOLD = 3;
export const REGISTER_CHUNK = 5; // §12: registerCentres in chunks of 5
const MIN_RELEASE_IN = 30;
/** Stop registering if fewer than this many seconds of chain time remain before release. */
const REGISTRATION_MARGIN = 15n;
const FILE_VERSION = 1;

export type SeedConfig = {
  authority: LocalAccount;
  custodians: Address[];
  codebookSeed: Uint8Array;
};

export type SeedOpts = {
  centres: number;
  releaseIn: number; // seconds of chain time from now
  revealAfter: number; // seconds after releaseTime
  paper?: string;
  dryRun?: boolean;
  rpc?: string; // local tests only
  contract?: string; // local tests only
  outRoot?: string; // default demo-data/secrets
};

export type SeedResult = {
  examId: bigint;
  dir: string;
  releaseTime: bigint;
  revealTime: bigint;
  txs: { createExam: Hash; registerCentres: Hash[] };
};

const randomBytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const iso = (t: bigint) => new Date(Number(t) * 1000).toISOString();
const local = (t: bigint) => new Date(Number(t) * 1000).toLocaleTimeString("en-GB", { hour12: false });

/** Read AUTHORITY_PRIVATE_KEY, CUSTODIAN_ADDRESSES and DEMO_CODEBOOK_SEED. Values are never printed. */
export function configFromEnv(): SeedConfig {
  loadEnv();
  const pk = process.env.AUTHORITY_PRIVATE_KEY?.trim();
  if (!pk) throw new UserError("AUTHORITY_PRIVATE_KEY is not set in .env.local");
  const pkHex = (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pkHex)) throw new UserError("AUTHORITY_PRIVATE_KEY must be 32 bytes of hex");
  const list = (process.env.CUSTODIAN_ADDRESSES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) throw new UserError("CUSTODIAN_ADDRESSES is not set in .env.local (5 comma-separated addresses)");
  const bad = list.find((a) => !isAddress(a, { strict: false }));
  if (bad) throw new UserError(`CUSTODIAN_ADDRESSES contains an invalid address: ${bad}`);
  return {
    authority: privateKeyToAccount(pkHex),
    custodians: list.map((a) => getAddress(a)),
    codebookSeed: secret32(undefined, "DEMO_CODEBOOK_SEED"),
  };
}

function checkConfig(cfg: SeedConfig): void {
  const lower = cfg.custodians.map((a) => a.toLowerCase());
  if (cfg.custodians.length !== 5) throw new UserError(`Need exactly 5 custodian addresses (§12), got ${cfg.custodians.length}`);
  if (new Set(lower).size !== lower.length) throw new UserError("CUSTODIAN_ADDRESSES has a duplicate address");
}

type CentreMaterial = {
  centreId: number;
  code: CentreCode;
  variant: VariantPaper;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  blob: Uint8Array;
  sealed: Uint8Array[]; // index i = custodian i
  fingerprint: Uint8Array;
  fpSalt: Uint8Array;
  fpCommitment: Hex;
};

async function buildCentre(master: MasterPaper, code: CentreCode, examId: bigint, custodianCount: number): Promise<CentreMaterial> {
  const variant = buildVariant(master, code);
  const { publicKey, privateKey } = generateCentreKeypair();
  const key = generateAesKey();
  // Plaintext is the VariantPaper JSON: the centre page does JSON.parse(TextDecoder(plaintext)).
  const blob = await aesGcmEncrypt(key, utf8(canonicalJson(variant)), variantAad(examId, code.centreId));
  const pieces = await splitKey(key, custodianCount, THRESHOLD);
  key.fill(0); // the AES key exists only in memory during seeding (§5)
  const sealed = await Promise.all(pieces.map((p) => sealPiece(p, publicKey, examId, code.centreId)));
  for (const p of pieces) p.fill(0);
  const fingerprint = encodeFingerprint(master, code);
  const fpSalt = randomBytes(32);
  return {
    centreId: code.centreId,
    code,
    variant,
    publicKey,
    privateKey,
    blob,
    sealed,
    fingerprint,
    fpSalt,
    fpCommitment: fingerprintCommitment(examId, code.centreId, fingerprint, fpSalt),
  };
}

function writeSecrets(
  dir: string,
  ctx: { examId: bigint; contract: Address; custodians: Address[]; codebookSeed: Uint8Array; paperSalt: Uint8Array; paperCommitment: Hex },
  centres: CentreMaterial[],
): void {
  const examId = ctx.examId.toString();
  for (const sub of ["centres", "custodians", "variants"]) mkdirSync(path.join(dir, sub), { recursive: true });

  for (const c of centres) {
    writeFileSync(
      path.join(dir, "centres", `centre-${c.centreId}.centrekey.secret.json`),
      jsonStringify({
        version: FILE_VERSION,
        examId,
        contract: ctx.contract,
        centreId: c.centreId,
        x25519PublicKey: toHexBytes(c.publicKey),
        x25519PrivateKey: toHexBytes(c.privateKey),
      }),
    );
    writeFileSync(path.join(dir, "variants", `centre-${c.centreId}.variant.secret.json`), jsonStringify(c.variant));
    writeFileSync(path.join(dir, "variants", `centre-${c.centreId}.html`), renderVariantHtml(c.variant));
  }

  ctx.custodians.forEach((addr, i) => {
    writeFileSync(
      path.join(dir, "custodians", `custodian-${i + 1}-${addr.slice(0, 8).toLowerCase()}.custodian.secret.json`),
      jsonStringify({
        version: FILE_VERSION,
        examId,
        contract: ctx.contract,
        custodianIndex: i,
        custodianAddress: addr,
        shares: centres.map((c) => ({ centreId: c.centreId, sealedShare: toHexBytes(c.sealed[i]) })),
      }),
    );
  });

  writeFileSync(
    path.join(dir, "codebook.secret.json"),
    jsonStringify({ version: FILE_VERSION, codebookSeed: toHexBytes(ctx.codebookSeed), centres: centres.map((c) => c.code) }),
  );
  writeFileSync(
    path.join(dir, "reveal.secret.json"),
    jsonStringify({
      examId,
      contract: ctx.contract,
      centres: centres.map((c) => ({ centreId: c.centreId, fingerprint: toHexBytes(c.fingerprint), salt: toHexBytes(c.fpSalt) })),
    }),
  );
  // Not in the §7 table: the paper salt opens paperCommitment later. Authority only.
  writeFileSync(
    path.join(dir, "paper.secret.json"),
    jsonStringify({ examId, paperCommitment: ctx.paperCommitment, paperSalt: toHexBytes(ctx.paperSalt) }),
  );
}

function appendDemoRun(s: {
  examId: bigint;
  contract: Address;
  releaseTime: bigint;
  centres: number;
  createTx: string;
  explorerTx: (h: string) => string;
}): void {
  const file = path.join(ROOT, "docs", "DEMO_RUNS.md");
  if (!existsSync(file)) {
    writeFileSync(
      file,
      "# Demo runs\n\nAppended by `pnpm ops seed` (testnet only). Times are chain time, UTC.\n\n" +
        "| Exam | Seeded (UTC) | Release (UTC) | Centres | Contract | createExam tx |\n|---|---|---|---|---|---|\n",
    );
  }
  appendFileSync(
    file,
    `| ${s.examId} | ${new Date().toISOString().slice(0, 19)}Z | ${iso(s.releaseTime).slice(0, 19)}Z | ${s.centres} | \`${s.contract}\` | [${s.createTx.slice(0, 10)}…](${s.explorerTx(s.createTx)}) |\n`,
  );
}

/**
 * pnpm ops seed --centres 20 --release-in 150 --reveal-after 120 [--dry-run]
 * Full seed per CLAUDE.md §12 / §7. See the numbered steps below.
 */
export async function seed(opts: SeedOpts, cfg: SeedConfig): Promise<SeedResult | null> {
  // 1. Inputs
  if (!Number.isInteger(opts.centres) || opts.centres < 1 || opts.centres > 100) throw new UserError("--centres must be 1..100");
  if (!Number.isInteger(opts.releaseIn) || opts.releaseIn < MIN_RELEASE_IN) throw new UserError(`--release-in must be at least ${MIN_RELEASE_IN} seconds`);
  if (!Number.isInteger(opts.revealAfter) || opts.revealAfter < 0) throw new UserError("--reveal-after must be ≥ 0 seconds");
  checkConfig(cfg);

  const paperFile = resolvePaperPath(opts.paper);
  const check = validateMasterPaper(readJson(paperFile));
  if (!check.ok) {
    check.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    throw new UserError(`${rel(paperFile)} does not pass validate-paper; fix it before seeding.`);
  }
  const master = check.paper;
  const centreIds = Array.from({ length: opts.centres }, (_, i) => i + 1);
  // Demo codebook: same seed every run so printed leak photos keep matching (§9).
  const codebook = generateCodebook(master, centreIds, cfg.codebookSeed);

  // 2. Chain preflight
  const conn: Conn = await connect({ rpc: opts.rpc, contract: opts.contract });
  const pc = conn.publicClient;
  const [balance, nextId, now] = await Promise.all([
    pc.getBalance({ address: cfg.authority.address }),
    pc.readContract({ address: conn.registry, abi: registryAbi, functionName: "nextExamId" }) as Promise<bigint>,
    chainTime(conn),
  ]);
  const outRoot = opts.outRoot ? userPath(opts.outRoot) : path.join(ROOT, "demo-data", "secrets");
  console.log(`Chain ${conn.chain.id}${conn.isTestnet ? " (MST Testnet)" : " (LOCAL TEST CHAIN)"} · registry ${conn.registry}`);
  console.log(`Authority ${cfg.authority.address} · balance ${balance} wei`);
  console.log(`Custodians (piece order): ${cfg.custodians.join(", ")}`);
  console.log(`Paper "${master.title}" · ${centreIds.length} centres · threshold ${THRESHOLD} of ${cfg.custodians.length}`);
  if (balance === 0n) throw new UserError("The authority wallet has no funds. Claim from https://faucet.masterstroke.academy");
  if (existsSync(path.join(outRoot, `exam-${nextId}`))) {
    throw new UserError(`${path.join(outRoot, `exam-${nextId}`)} already exists; refusing to overwrite secrets`);
  }

  const releaseTime = now + BigInt(opts.releaseIn);
  const revealTime = releaseTime + BigInt(opts.revealAfter);
  const paperSalt = randomBytes(32);
  const paperCommit = paperCommitment(master, paperSalt);
  const createArgs = [master.title, paperCommit, releaseTime, revealTime, cfg.custodians, THRESHOLD] as const;

  // createExam dry run: eth_call only, sends nothing.
  await pc.simulateContract({ account: cfg.authority, address: conn.registry, abi: registryAbi, functionName: "createExam", args: createArgs });

  if (opts.dryRun) {
    const sample = await buildCentre(master, codebook[0], nextId, cfg.custodians.length);
    console.log("\nDRY RUN: nothing sent, nothing written.");
    console.log(`  Would create exam #${nextId} (if nobody else creates one first)`);
    console.log(`  Release ${iso(releaseTime)} (local ${local(releaseTime)}), reveal ${iso(revealTime)}`);
    console.log(`  createExam: simulated OK`);
    console.log(`  registerCentres: ${Math.ceil(centreIds.length / REGISTER_CHUNK)} tx(s) of up to ${REGISTER_CHUNK} centres, ~${sample.blob.length} bytes of ciphertext each`);
    console.log(`  Secrets would go to ${path.join(outRoot, `exam-${nextId}`)}`);
    return null;
  }

  // 3. createExam first: examId goes into every AAD (§7 seeding order)
  const wc = wallet(conn, cfg.authority);
  console.log("\nSending createExam…");
  const createTx = await wc.writeContract({ address: conn.registry, abi: registryAbi, functionName: "createExam", args: createArgs });
  const createReceipt = await confirm(conn, createTx, "createExam");
  const created = parseEventLogs({ abi: registryAbi, eventName: "ExamCreated", logs: createReceipt.logs });
  if (created.length !== 1) throw new UserError(`createExam mined but ExamCreated was not found: ${conn.explorerTx(createTx)}`);
  const examId = created[0].args.examId as bigint;
  console.log(`  exam #${examId} created in block ${createReceipt.blockNumber}: ${conn.explorerTx(createTx)}`);

  // 4. Per-centre material: variant → AES → Shamir 3-of-5 → sealed pieces → fingerprint commitment
  const centres: CentreMaterial[] = [];
  for (const code of codebook) centres.push(await buildCentre(master, code, examId, cfg.custodians.length));

  // 5. Write secrets before registering, so an interrupted run still leaves usable files.
  const dir = path.join(outRoot, `exam-${examId}`);
  if (existsSync(dir)) throw new UserError(`${dir} already exists; refusing to overwrite secrets`);
  writeSecrets(dir, { examId, contract: conn.registry, custodians: cfg.custodians, codebookSeed: cfg.codebookSeed, paperSalt, paperCommitment: paperCommit }, centres);
  // Seat variants for digital exams (D9). Never allowed to break a seed: `ops candidates` can redo it.
  try {
    const seats = Array.from({ length: DEFAULT_SEATS }, (_, i) => i + 1);
    const sks = new Map(centres.map((c) => [c.centreId, c.privateKey] as const));
    writeCandidatesFile(dir, examId.toString(), buildCandidates(master, centres.map((c) => c.code), sks, seats), seats);
  } catch (e) {
    console.warn(`  WARNING: seat variants not written (${(e as Error).message}); run \`pnpm ops candidates --exam ${examId}\` later.`);
  }
  const summary = {
    status: "registering" as string,
    examId,
    chainId: conn.chain.id,
    contract: conn.registry,
    authority: cfg.authority.address,
    custodians: cfg.custodians,
    threshold: THRESHOLD,
    centreIds,
    title: master.title,
    paperCommitment: paperCommit,
    releaseTime,
    releaseTimeUtc: iso(releaseTime),
    revealTime,
    revealTimeUtc: iso(revealTime),
    codebook: "demo codebook from DEMO_CODEBOOK_SEED (same for every demo exam, §9)",
    createdBlock: createReceipt.blockNumber,
    txs: { createExam: createTx, registerCentres: [] as Hash[] },
    explorer: { createExam: conn.explorerTx(createTx), registerCentres: [] as string[] },
  };
  const writeSummary = () => writeFileSync(path.join(dir, "summary.json"), jsonStringify(summary));
  writeSummary();

  // 6. registerCentres in chunks of 5 (ciphertext goes on-chain in events; commitment computed on-chain)
  for (let i = 0; i < centres.length; i += REGISTER_CHUNK) {
    const chunk = centres.slice(i, i + REGISTER_CHUNK);
    const left = releaseTime - (await chainTime(conn));
    if (left < REGISTRATION_MARGIN) {
      summary.status = "incomplete: release time too close";
      writeSummary();
      throw new UserError(`Only ${left}s of chain time left before release; registration would close. Re-run with a larger --release-in.`);
    }
    const ids = chunk.map((c) => c.centreId);
    const tx = await wc.writeContract({
      address: conn.registry,
      abi: registryAbi,
      functionName: "registerCentres",
      args: [examId, ids, chunk.map((c) => toHexBytes(c.publicKey)), chunk.map((c) => c.fpCommitment), chunk.map((c) => toHexBytes(c.blob))],
    });
    const r = await confirm(conn, tx, `registerCentres(${ids.join(",")})`);
    summary.txs.registerCentres.push(tx);
    summary.explorer.registerCentres.push(conn.explorerTx(tx));
    writeSummary();
    console.log(`  centres ${ids[0]}–${ids[ids.length - 1]} registered in block ${r.blockNumber}: ${conn.explorerTx(tx)}`);
  }

  // 7. Read back and check every centre against what we computed
  const exam = (await pc.readContract({ address: conn.registry, abi: registryAbi, functionName: "getExam", args: [examId] })) as {
    custodians: readonly Address[];
    centreCount: number;
    releaseTime: bigint;
  };
  if (exam.custodians.map((a) => a.toLowerCase()).join() !== cfg.custodians.map((a) => a.toLowerCase()).join()) {
    throw new UserError("On-chain custodian order differs from CUSTODIAN_ADDRESSES");
  }
  for (const c of centres) {
    const v = (await pc.readContract({ address: conn.registry, abi: registryAbi, functionName: "getCentre", args: [examId, c.centreId] })) as {
      status: number;
      encPubKey: Hex;
      variantCommitment: Hex;
      fingerprintCommitment: Hex;
    };
    const ok =
      v.status === 1 &&
      v.encPubKey.toLowerCase() === toHexBytes(c.publicKey) &&
      v.variantCommitment.toLowerCase() === variantCommitment(c.blob) &&
      v.fingerprintCommitment.toLowerCase() === c.fpCommitment;
    if (!ok) throw new UserError(`Centre ${c.centreId}: on-chain record does not match the seeded material`);
  }
  summary.status = "sealed";
  writeSummary();
  if (conn.isTestnet) {
    appendDemoRun({ examId, contract: conn.registry, releaseTime, centres: centres.length, createTx, explorerTx: conn.explorerTx });
  }

  // 8. Report
  console.log(`\nExam #${examId} sealed: ${centres.length} centres verified on-chain (commitments match).`);
  console.log(`Release opens at chain time ${iso(releaseTime)} (local ${local(releaseTime)}); fingerprints revealable from ${iso(revealTime)}.`);
  console.log(`Secret files: ${dir}`);
  console.log(`  custodians/  → load in /custodian (custodians 1–3 in BridgeKey; 4–5 via ops release)`);
  console.log(`  centres/     → load in /centre`);
  console.log(`  codebook.secret.json → load in /trace`);
  console.log(`Control room: /?exam=${examId}`);
  return { examId, dir, releaseTime, revealTime, txs: summary.txs };
}
