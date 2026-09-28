import dns from "node:dns";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { type Hex, fromHexBytes } from "examseal-core";

// Prefer IPv4 for every outbound request (RPC, Gemini, Groq, MSTScan). On the team laptop Node's
// fetch hit "read ECONNRESET" over IPv6 while curl worked; ipv4first fixed it (29 Sep, G4 checks).
dns.setDefaultResultOrder("ipv4first");

/** Repo root (the directory holding pnpm-workspace.yaml). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let loaded = false;
/** Load ROOT/.env.local into process.env. Values are never printed. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  dotenv.config({ path: path.join(ROOT, ".env.local"), quiet: true } as dotenv.DotenvConfigOptions);
}

export class UserError extends Error {}

export const MASTER_PAPER = path.join(ROOT, "demo-data", "master-paper.json");
export const EXAMPLE_PAPER = path.join(ROOT, "demo-data", "master-paper.example.json");

/** Resolve --paper, else the master paper, else the example (with a notice). */
export function resolvePaperPath(arg: string | undefined): string {
  if (arg) return userPath(arg);
  if (existsSync(MASTER_PAPER)) return MASTER_PAPER;
  if (existsSync(EXAMPLE_PAPER)) {
    console.warn(`NOTE: ${rel(MASTER_PAPER)} does not exist yet; using ${rel(EXAMPLE_PAPER)}.`);
    return EXAMPLE_PAPER;
  }
  throw new UserError(`${rel(MASTER_PAPER)} not found. Pass --paper <path>.`);
}

export function readJson(file: string): unknown {
  if (!existsSync(file)) throw new UserError(`File not found: ${file}`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new UserError(`${rel(file)} is not valid JSON: ${(e as Error).message}`);
  }
}

/** A 32-byte hex secret from --flag or an env var. Never echoed. */
export function secret32(cliValue: string | undefined, envName: string): Uint8Array {
  loadEnv();
  const v = (cliValue ?? process.env[envName])?.trim();
  if (!v) {
    throw new UserError(
      `${envName} is not set in .env.local. Generate one with:\n` +
        `  node -e "console.log('0x'+require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new UserError(`${envName} must be 0x followed by 64 hex digits`);
  return fromHexBytes(v as Hex);
}

export function rel(p: string): string {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

/** Resolve a path the user typed, relative to where they ran pnpm (pnpm sets INIT_CWD). */
export function userPath(p: string): string {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), p);
}
