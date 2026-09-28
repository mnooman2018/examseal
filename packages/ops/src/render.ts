import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type CentreCode,
  type MasterPaper,
  buildVariant,
  generateCodebook,
  renderVariantHtml,
  validateMasterPaper,
} from "examseal-core";
import { ROOT, UserError, readJson, rel, resolvePaperPath, secret32, userPath } from "./env";

export type RenderOpts = {
  centre: string;
  exam?: string;
  centres?: string;
  paper?: string;
  seed?: string;
  out?: string;
  force?: boolean;
};

/**
 * pnpm ops render --centre 14 [--exam <id>] [--centres 20] [--paper <path>] [--out <dir>] [--force]
 *
 * With --exam, uses that exam's codebook.secret.json if seed has written it. Otherwise
 * regenerates the demo codebook from DEMO_CODEBOOK_SEED for centres 1..N (the same one
 * `ops seed` uses), so Dhruva can print a variant before any exam exists.
 * Output goes under demo-data/secrets/ (gitignored) unless --out is given.
 */
export function render(opts: RenderOpts): number {
  const centreId = Number(opts.centre);
  if (!Number.isInteger(centreId) || centreId < 0) throw new UserError("--centre <id> is required (e.g. --centre 14)");

  const paperFile = resolvePaperPath(opts.paper);
  const raw = readJson(paperFile);
  const check = validateMasterPaper(raw);
  if (!check.ok) {
    console.log(`${rel(paperFile)} does not pass validate-paper:`);
    check.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    if (!opts.force) throw new UserError("Fix the paper first, or pass --force to render anyway (dev only).");
    console.log("--force: rendering anyway.");
  }
  const master = raw as MasterPaper;

  let code: CentreCode | undefined;
  let source: string;
  const examDir = opts.exam ? path.join(ROOT, "demo-data", "secrets", `exam-${opts.exam}`) : undefined;
  const examCodebook = examDir ? path.join(examDir, "codebook.secret.json") : undefined;
  if (examCodebook && existsSync(examCodebook)) {
    const book = readJson(examCodebook) as { centres?: CentreCode[] };
    code = book.centres?.find((c) => c.centreId === centreId);
    if (!code) throw new UserError(`Centre ${centreId} is not in exam ${opts.exam}'s codebook`);
    source = `exam ${opts.exam} codebook`;
  } else {
    if (opts.exam) console.log(`NOTE: no codebook for exam ${opts.exam} yet; regenerating the demo codebook.`);
    const n = Number(opts.centres ?? 20);
    if (!Number.isInteger(n) || n < 1) throw new UserError("--centres must be a positive integer");
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    if (!ids.includes(centreId)) throw new UserError(`Centre ${centreId} is outside 1..${n}`);
    const seed = secret32(opts.seed, "DEMO_CODEBOOK_SEED");
    code = generateCodebook(master, ids, seed).find((c) => c.centreId === centreId)!;
    source = `demo codebook, centres 1..${n}`;
  }

  const html = renderVariantHtml(buildVariant(master, code));
  const outDir = opts.out
    ? userPath(opts.out)
    : examDir
      ? path.join(examDir, "variants")
      : path.join(ROOT, "demo-data", "secrets", "render");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `centre-${centreId}.html`);
  writeFileSync(outFile, html);
  console.log(`Wrote centre ${centreId}'s printable paper (${source}) to:`);
  console.log(`  ${outFile}`);
  console.log("Open it in a browser and print (A4). It shows no centre number.");
  return 0;
}
