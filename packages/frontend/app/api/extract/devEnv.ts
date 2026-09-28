import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const NAMES = ["GEMINI_API_KEY", "GEMINI_MODEL", "EXTRACTOR_PROVIDER"] as const;
let done = false;

/**
 * Local development only. Next.js reads .env.local from packages/frontend, but the team keeps
 * secrets in the repo-root .env.local (CLAUDE.md §12). When running `pnpm dev` and these names
 * are not already set, copy just these three from the root file into process.env.
 * On Vercel (process.env.VERCEL) nothing is read; values come from the project settings.
 * Values are never logged.
 */
export function loadRootEnvForDev(): void {
  if (done) return;
  done = true;
  if (process.env.VERCEL || process.env.NODE_ENV === "production") return;
  if (NAMES.every((n) => process.env[n])) return;
  const file = path.resolve(process.cwd(), "../../.env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || !(NAMES as readonly string[]).includes(m[1]) || process.env[m[1]]) continue;
    const value = m[2].replace(/\s+#.*$/, "").replace(/^(['"])(.*)\1$/, "$2");
    if (value) process.env[m[1]] = value;
  }
}
