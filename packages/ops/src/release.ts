import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Hex } from "examseal-core";
import { type Address, type Hash, type LocalAccount, getAddress, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Conn, chainTime, confirm, connect, registryAbi, wallet } from "./chain";
import { ROOT, UserError, loadEnv, readJson, userPath } from "./env";

export type ReleaseOpts = {
  examId: bigint;
  custodian: number; // 1-based, as in the file name custodian-4-….custodian.secret.json
  wait?: boolean; // wait (in chain time) for releaseTime instead of refusing
  rpc?: string; // local tests only
  contract?: string; // local tests only
  secretsRoot?: string; // default demo-data/secrets
};

export type ReleaseResult = {
  tx: Hash | null;
  released: number[];
  skipped: { centreId: number; reason: number }[];
  authorized: number[];
};

type CustodianFile = {
  examId: string;
  contract: string;
  custodianIndex: number;
  custodianAddress: string;
  shares: { centreId: number; sealedShare: Hex }[];
};

const SKIP_REASONS: Record<number, string> = { 1: "centre compromised", 2: "already released", 3: "unknown centre", 4: "bad piece length" };
const COMPROMISED = 3;

/** CUSTODIAN_<n>_PRIVATE_KEY from .env.local. Never printed. */
export function custodianAccountFromEnv(n: number): LocalAccount {
  loadEnv();
  const name = `CUSTODIAN_${n}_PRIVATE_KEY`;
  const raw = process.env[name]?.trim();
  if (!raw) throw new UserError(`${name} is not set in .env.local`);
  const pk = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new UserError(`${name} must be 32 bytes of hex`);
  return privateKeyToAccount(pk);
}

function loadCustodianFile(dir: string, n: number): CustodianFile {
  const sub = path.join(dir, "custodians");
  if (!existsSync(sub)) throw new UserError(`No custodian files in ${dir}. Was this exam seeded on this machine?`);
  const matches = readdirSync(sub).filter((f) => f.startsWith(`custodian-${n}-`) && f.endsWith(".custodian.secret.json"));
  if (matches.length !== 1) throw new UserError(`Expected one custodian-${n}-*.custodian.secret.json in ${sub}, found ${matches.length}`);
  return readJson(path.join(sub, matches[0])) as CustodianFile;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * pnpm ops release --exam <id> --custodian 4 [--wait]
 * Releases a scripted custodian's sealed pieces for every centre in one releaseShares tx (§12).
 */
export async function release(opts: ReleaseOpts, account: LocalAccount): Promise<ReleaseResult> {
  if (!Number.isInteger(opts.custodian) || opts.custodian < 1) throw new UserError("--custodian must be a number like 4");
  const root = opts.secretsRoot ? userPath(opts.secretsRoot) : path.join(ROOT, "demo-data", "secrets");
  const file = loadCustodianFile(path.join(root, `exam-${opts.examId}`), opts.custodian);

  const conn: Conn = await connect({ rpc: opts.rpc, contract: opts.contract });
  const pc = conn.publicClient;
  const me = getAddress(account.address);

  // The key, the file, and the on-chain custodian slot must all agree.
  if (BigInt(file.examId) !== opts.examId) throw new UserError(`The custodian file is for exam ${file.examId}, not ${opts.examId}`);
  if (getAddress(file.contract) !== conn.registry) throw new UserError(`The custodian file is for registry ${file.contract}, not ${conn.registry}`);
  if (getAddress(file.custodianAddress) !== me) {
    throw new UserError(`CUSTODIAN_${opts.custodian}_PRIVATE_KEY is for ${me}, but the file belongs to ${file.custodianAddress}`);
  }
  const exam = (await pc.readContract({ address: conn.registry, abi: registryAbi, functionName: "getExam", args: [opts.examId] })) as {
    custodians: readonly Address[];
    releaseTime: bigint;
    threshold: number;
  };
  if (getAddress(exam.custodians[file.custodianIndex] ?? "0x0000000000000000000000000000000000000000") !== me) {
    throw new UserError(`${me} is not custodian #${file.custodianIndex + 1} of exam ${opts.examId} on-chain`);
  }
  console.log(`Exam #${opts.examId} · custodian ${opts.custodian} (${me}) · ${file.shares.length} sealed pieces in file`);

  // Release is time-locked on-chain; a tx before releaseTime reverts (that demo lives in /custodian).
  let now = await chainTime(conn);
  if (now < exam.releaseTime) {
    const left = exam.releaseTime - now;
    if (!opts.wait) {
      throw new UserError(
        `Release opens in ${left}s (chain time ${new Date(Number(exam.releaseTime) * 1000).toISOString()}). Re-run then, or add --wait.`,
      );
    }
    console.log(`Waiting ${left}s of chain time for release to open…`);
    while (now < exam.releaseTime) {
      await sleep(3_000);
      now = await chainTime(conn);
    }
  }

  // Skip what the contract would skip anyway, so the tx carries only live pieces.
  const toSend: CustodianFile["shares"] = [];
  const skipped: ReleaseResult["skipped"] = [];
  for (const s of file.shares) {
    const [done, centre] = await Promise.all([
      pc.readContract({ address: conn.registry, abi: registryAbi, functionName: "hasReleased", args: [opts.examId, s.centreId, me] }) as Promise<boolean>,
      pc.readContract({ address: conn.registry, abi: registryAbi, functionName: "getCentre", args: [opts.examId, s.centreId] }) as Promise<{ status: number }>,
    ]);
    if (done) skipped.push({ centreId: s.centreId, reason: 2 });
    else if (centre.status === COMPROMISED) skipped.push({ centreId: s.centreId, reason: 1 });
    else toSend.push(s);
  }
  if (toSend.length === 0) {
    console.log(`Nothing to release: ${skipped.length} centre(s) already released or revoked. No transaction sent.`);
    return { tx: null, released: [], skipped, authorized: [] };
  }

  const balance = await pc.getBalance({ address: me });
  if (balance === 0n) throw new UserError(`${me} has no funds. Claim from https://faucet.masterstroke.academy`);

  console.log(`Sending releaseShares for ${toSend.length} centre(s)…`);
  const tx = await wallet(conn, account).writeContract({
    address: conn.registry,
    abi: registryAbi,
    functionName: "releaseShares",
    args: [opts.examId, toSend.map((s) => s.centreId), toSend.map((s) => s.sealedShare)],
  });
  const receipt = await confirm(conn, tx, "releaseShares");

  const released = parseEventLogs({ abi: registryAbi, eventName: "ShareReleased", logs: receipt.logs }).map((l) => Number(l.args.centreId));
  const chainSkipped = parseEventLogs({ abi: registryAbi, eventName: "ShareSkipped", logs: receipt.logs }).map((l) => ({
    centreId: Number(l.args.centreId),
    reason: Number(l.args.reason),
  }));
  const authorized = parseEventLogs({ abi: registryAbi, eventName: "ReleaseAuthorized", logs: receipt.logs }).map((l) => Number(l.args.centreId));
  const allSkipped = [...skipped, ...chainSkipped];

  console.log(`  confirmed in block ${receipt.blockNumber}: ${conn.explorerTx(tx)}`);
  console.log(`  released ${released.length} piece(s)${authorized.length ? `; release authorized for centre(s) ${authorized.join(", ")}` : ""}`);
  for (const s of allSkipped) console.log(`  skipped centre ${s.centreId}: ${SKIP_REASONS[s.reason] ?? `reason ${s.reason}`}`);
  return { tx, released, skipped: allSkipped, authorized };
}

/** Parse "--custodian 4" or "--custodian 4,5". */
export function parseCustodianList(v: string | undefined): number[] {
  const list = (v ?? "").split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
  if (list.length === 0 || list.some((n) => !Number.isInteger(n))) throw new UserError("--custodian is required, e.g. --custodian 4 or --custodian 4,5");
  return [...new Set(list)];
}
