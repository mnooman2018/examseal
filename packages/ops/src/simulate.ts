import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  type CentreCode,
  type Extraction,
  LEAD_FRACTION_PERCENT,
  MATCHER_VERSION,
  MIN_LEAD,
  MIN_MATCH_PERCENT,
  MIN_OBSERVED_FEATURES,
  OPTION_MIN_SIMILARITY,
  QUESTION_MIN_MARGIN,
  QUESTION_MIN_SIMILARITY,
  WORDING_MIN_GAP,
  type CandidateCode,
  SEAT_MIN_LEAD,
  decide,
  decideWithCandidates,
  deriveCandidateSeed,
  generateCandidates,
  generateCodebook,
  identifyQuestions,
  scoreCentres,
  syntheticExtraction,
  validateMasterPaper,
} from "examseal-core";
import { ROOT, UserError, readJson, rel, resolvePaperPath } from "./env";

// §10 simulation. Deterministic from --seed: anyone can rerun it and get the same table.
// Codebooks come from public seeds derived here, never from DEMO_CODEBOOK_SEED.

export type SimulateOpts = { trials?: number; seed?: string; codebooks?: number; paper?: string; out?: string };

const KS = [2, 3, 4, 6, 8, 12] as const; // §10
const CENTRES = 20;
const SEATS = 30; // D9
const NOISE = { typo: 0.05, dropOption: 0.2, dropNumber: 0.3 }; // §10

const sha = (s: string) => new Uint8Array(createHash("sha256").update(s).digest());

/** mulberry32: small, fast, deterministic. Simulation sampling only; codebooks use SHA-256 (core). */
function prng(seed: string): () => number {
  const b = sha(`${seed}/prng`);
  let a = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand: () => number, n: number, k: number): number[] {
  const all = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, k).sort((a, b) => a - b);
}

/** §10 noise: 5% character typos, each option dropped with 20%, printed number missing with 30%. */
function addNoise(x: Extraction, rand: () => number): Extraction {
  const typo = (s: string) =>
    [...s].map((c) => (/\p{L}/u.test(c) && rand() < NOISE.typo ? String.fromCharCode(97 + Math.floor(rand() * 26)) : c)).join("");
  return {
    legibility: "partial",
    questions: x.questions.map((q) => ({
      printedNumber: rand() < NOISE.dropNumber ? null : q.printedNumber,
      text: typo(q.text),
      options: q.options.filter(() => rand() >= NOISE.dropOption).map((o) => ({ label: o.label, text: typo(o.text) })),
    })),
  };
}

type Tally = { trials: number; correct: number; wrong: number; inconclusive: number; notThisExam: number; observedSum: number; identifiedSum: number };
const tally = (): Tally => ({ trials: 0, correct: 0, wrong: 0, inconclusive: 0, notThisExam: 0, observedSum: 0, identifiedSum: 0 });

function run(
  master: Parameters<typeof identifyQuestions>[1],
  x: Extraction,
  book: CentreCode[],
  trueCentre: number | null,
  t: Tally,
): ReturnType<typeof decide> {
  const obs = identifyQuestions(x, master);
  const scores = scoreCentres(obs, book);
  const d = decide(scores, obs.length);
  t.trials++;
  t.identifiedSum += obs.length;
  t.observedSum += scores[0]?.observed ?? 0;
  if (d.kind === "MATCH") {
    if (trueCentre !== null && d.centreId === trueCentre) t.correct++;
    else t.wrong++;
  } else if (d.kind === "INCONCLUSIVE") t.inconclusive++;
  else t.notThisExam++;
  return d;
}

type FalseMatch = { row: string; trial: number; codebook: number; source: string; matched: number; observed: number; centre: number; runnerUp?: number; runnerUpMatched?: number };

const pct = (n: number, d: number) => (d === 0 ? "–" : `${((100 * n) / d).toFixed(1)}%`);
const avg = (n: number, d: number) => (d === 0 ? "–" : (n / d).toFixed(1));

/** pnpm ops simulate [--trials 1000] [--seed examseal-sim-v1] [--codebooks 5] → docs/SIMULATION.md */
export function simulate(opts: SimulateOpts): number {
  const trials = opts.trials ?? 1000;
  const seed = opts.seed ?? "examseal-sim-v1";
  const nBooks = opts.codebooks ?? 5;
  if (!Number.isInteger(trials) || trials < 1) throw new UserError("--trials must be a positive integer");
  if (!Number.isInteger(nBooks) || nBooks < 1) throw new UserError("--codebooks must be a positive integer");

  const paperFile = resolvePaperPath(opts.paper);
  const check = validateMasterPaper(readJson(paperFile));
  if (!check.ok) throw new UserError(`${rel(paperFile)} does not pass validate-paper`);
  const master = check.paper;
  const n = master.questions.length;
  const ids = Array.from({ length: CENTRES }, (_, i) => i + 1);
  const started = Date.now();

  console.log(`Generating ${nBooks} exam codebooks and ${nBooks} fake codebooks (${CENTRES} centres each)…`);
  const books = Array.from({ length: nBooks }, (_, i) => generateCodebook(master, ids, sha(`${seed}/exam-codebook/${i}`)));
  const fakeBooks = Array.from({ length: nBooks }, (_, i) => generateCodebook(master, ids, sha(`${seed}/fake-codebook/${i}`)));
  const masterOrder: CentreCode = {
    centreId: 0,
    order: master.questions.map((q) => q.id),
    optionPerms: Object.fromEntries(master.questions.map((q) => [q.id, [0, 1, 2, 3]])),
    wordings: Object.fromEntries(master.questions.map((q) => [q.id, 0 as const])),
  };

  const falseMatches: FalseMatch[] = [];
  const noteFalse = (row: string, trial: number, source: string, d: ReturnType<typeof decide>) => {
    if (d.kind !== "MATCH") return;
    falseMatches.push({
      row,
      trial,
      codebook: trial % nBooks,
      source,
      centre: d.centreId!,
      matched: d.best!.matched,
      observed: d.best!.observed,
      runnerUp: d.runnerUp?.centreId,
      runnerUpMatched: d.runnerUp?.matched,
    });
  };
  const real = new Map<number, Tally>();
  const fake = new Map<number, Tally>();
  const clean = new Map<number, Tally>();
  for (const k of KS) {
    const rand = prng(`${seed}/k=${k}`);
    const r = tally();
    const f = tally();
    const c = tally();
    for (let t = 0; t < trials; t++) {
      const book = books[t % nBooks];
      // Real leak: a random centre of this exam, k random questions, §10 noise.
      const code = book[Math.floor(rand() * book.length)];
      const positions = pick(rand, n, k);
      const exact = syntheticExtraction(master, code, positions);
      run(master, addNoise(exact, rand), book, code.centreId, r);
      run(master, exact, book, code.centreId, c);
      // Fake leak: a paper from a codebook that is not this exam's, same k and noise.
      const fb = fakeBooks[t % nBooks];
      const fcode = fb[Math.floor(rand() * fb.length)];
      const fd = run(master, addNoise(syntheticExtraction(master, fcode, pick(rand, n, k)), rand), book, null, f);
      noteFalse(`fake, k = ${k}`, t, `fake codebook ${t % nBooks}, centre ${fcode.centreId}`, fd);
    }
    real.set(k, r);
    fake.set(k, f);
    clean.set(k, c);
    console.log(
      `  k=${String(k).padStart(2)}: real ${r.correct}/${r.trials} correct, ${r.wrong} wrong · fake ${f.correct + f.wrong} false matches`,
    );
  }
  const mo = tally();
  const moRand = prng(`${seed}/master-order`);
  for (let t = 0; t < trials; t++) {
    noteFalse("master order", t, "master order", run(master, addNoise(syntheticExtraction(master, masterOrder), moRand), books[t % nBooks], null, mo));
  }
  console.log(`  master-order fake: ${mo.correct + mo.wrong} false matches of ${mo.trials}`);

  const totalRealWrong = [...real.values()].reduce((s, t) => s + t.wrong, 0);
  const totalRealTrials = [...real.values()].reduce((s, t) => s + t.trials, 0);
  const totalFakeMatch = [...fake.values()].reduce((s, t) => s + t.correct + t.wrong, 0) + mo.correct + mo.wrong;
  const totalFakeTrials = [...fake.values()].reduce((s, t) => s + t.trials, 0) + mo.trials;

  // D9: digital leaks traced to a seat. Seat seeds come from the public simulation seed.
  console.log(`Generating ${SEATS} seats per centre for each exam codebook…`);
  const seatList = Array.from({ length: SEATS }, (_, i) => i + 1);
  const cands: CandidateCode[][] = books.map((b, bi) =>
    b.flatMap((c) => generateCandidates(master, c, deriveCandidateSeed(sha(`${seed}/centre-key/${bi}/${c.centreId}`)), seatList)),
  );
  type SeatTally = { trials: number; rightSeat: number; centreOnly: number; inconclusive: number; wrongCentre: number; wrongSeat: number };
  const seatT = new Map<number, SeatTally>();
  const printedSeat = new Map<number, { trials: number; seatNamed: number; rightCentre: number; wrongCentre: number }>();
  for (const k of KS) {
    const rand = prng(`${seed}/seat/k=${k}`);
    const st: SeatTally = { trials: 0, rightSeat: 0, centreOnly: 0, inconclusive: 0, wrongCentre: 0, wrongSeat: 0 };
    const pt = { trials: 0, seatNamed: 0, rightCentre: 0, wrongCentre: 0 };
    for (let t = 0; t < trials; t++) {
      const bi = t % nBooks;
      const cand = cands[bi][Math.floor(rand() * cands[bi].length)];
      const x = addNoise(syntheticExtraction(master, cand, pick(rand, n, k)), rand);
      const r = decideWithCandidates(identifyQuestions(x, master), books[bi], cands[bi]);
      st.trials++;
      if (r.decision.kind !== "MATCH") st.inconclusive++;
      else if (r.decision.centreId !== cand.centreId) st.wrongCentre++;
      else if (!r.seat) st.centreOnly++;
      else if (r.seat.seat === cand.seat) st.rightSeat++;
      else st.wrongSeat++;
      // A printed (centre) paper traced with the seat file loaded must never be given a seat.
      const code = books[bi][Math.floor(rand() * books[bi].length)];
      const px = addNoise(syntheticExtraction(master, code, pick(rand, n, k)), rand);
      const pr = decideWithCandidates(identifyQuestions(px, master), books[bi], cands[bi]);
      pt.trials++;
      if (pr.seat) pt.seatNamed++;
      if (pr.decision.kind === "MATCH") pr.decision.centreId === code.centreId ? pt.rightCentre++ : pt.wrongCentre++;
    }
    seatT.set(k, st);
    printedSeat.set(k, pt);
    console.log(`  seat k=${String(k).padStart(2)}: right seat ${st.rightSeat}, centre only ${st.centreOnly}, wrong centre ${st.wrongCentre}, wrong seat ${st.wrongSeat} · printed given a seat ${pt.seatNamed}`);
  }
  const totalWrongSeat = [...seatT.values()].reduce((s, t) => s + t.wrongSeat + t.wrongCentre, 0);
  const totalSeatTrials = [...seatT.values()].reduce((s, t) => s + t.trials, 0);
  const totalPrintedSeat = [...printedSeat.values()].reduce((s, t) => s + t.seatNamed + t.wrongCentre, 0);
  const totalPrintedTrials = [...printedSeat.values()].reduce((s, t) => s + t.trials, 0);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  for (const m of falseMatches) {
    console.log(`  FALSE MATCH ${m.row} trial ${m.trial}: ${m.source} → centre ${m.centre}, ${m.matched}/${m.observed}, runner-up ${m.runnerUpMatched}`);
  }

  const lines: string[] = [];
  lines.push("# Simulation results");
  lines.push("");
  lines.push("Generated by `pnpm ops simulate` (CLAUDE.md §10). Every number below is computed by the code; none is estimated by hand.");
  lines.push("");
  lines.push(`- **Reproduce:** \`pnpm ops simulate --trials ${trials} --seed ${seed} --codebooks ${nBooks}\` (deterministic: same inputs, same table)`);
  lines.push(`- **Paper:** \`${rel(paperFile)}\` ("${master.title}", ${n} questions)`);
  lines.push(`- **Exam codebooks:** ${nBooks}, each with ${CENTRES} centres, from public seeds derived from \`${seed}\` (not the demo codebook). Trials rotate through them.`);
  lines.push(`- **Noise (§10):** ${NOISE.typo * 100}% of letters replaced at random, each option dropped with ${NOISE.dropOption * 100}% probability, printed question number missing with ${NOISE.dropNumber * 100}% probability.`);
  lines.push(`- **Matcher:** \`${MATCHER_VERSION}\`, thresholds as in \`packages/core/src/forensic/constants.ts\`: question similarity ≥ ${QUESTION_MIN_SIMILARITY} with a ${QUESTION_MIN_MARGIN} lead, wording gap ≥ ${WORDING_MIN_GAP}, option similarity ≥ ${OPTION_MIN_SIMILARITY}, at least ${MIN_OBSERVED_FEATURES} observed features, matched ≥ ${MIN_MATCH_PERCENT}% of observed, lead over the runner-up ≥ max(${MIN_LEAD}, ${LEAD_FRACTION_PERCENT}% of observed).`);
  lines.push("- **Threshold changes from the §10 defaults**, and the runs that justified them (including held-out seeds): `docs/DECISIONS.md` D8.");
  lines.push(`- **Run:** ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC, ${secs} s.`);
  lines.push("");
  lines.push("## Targets (§10)");
  lines.push("");
  lines.push(`| Target | Result | Met |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Real leaks attributed to the wrong centre (MATCH-wrong) = 0 | ${totalRealWrong} of ${totalRealTrials} | ${totalRealWrong === 0 ? "yes" : "**NO**"} |`);
  lines.push(`| Fake leaks attributed to any centre (false match) = 0 | ${totalFakeMatch} of ${totalFakeTrials} | ${totalFakeMatch === 0 ? "yes" : "**NO**"} |`);
  lines.push(`| Digital leaks attributed to the wrong seat or wrong centre = 0 (D9) | ${totalWrongSeat} of ${totalSeatTrials} | ${totalWrongSeat === 0 ? "yes" : "**NO**"} |`);
  lines.push(`| Printed leaks given a seat, or the wrong centre, with the seat file loaded = 0 (D9) | ${totalPrintedSeat} of ${totalPrintedTrials} | ${totalPrintedSeat === 0 ? "yes" : "**NO**"} |`);
  lines.push("");
  lines.push("## Real leaks with noise");
  lines.push("");
  lines.push(`A random centre's paper, k random questions visible, with the noise above. ${trials} trials per row.`);
  lines.push("");
  lines.push("| Visible questions (k) | MATCH, correct centre | INCONCLUSIVE | MATCH, wrong centre | Not this exam | Avg. questions identified | Avg. features observed |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const k of KS) {
    const t = real.get(k)!;
    lines.push(`| ${k} | ${t.correct} (${pct(t.correct, t.trials)}) | ${t.inconclusive} (${pct(t.inconclusive, t.trials)}) | ${t.wrong} | ${t.notThisExam} | ${avg(t.identifiedSum, t.trials)} | ${avg(t.observedSum, t.trials)} |`);
  }
  lines.push("");
  lines.push("## Real leaks without noise (reference)");
  lines.push("");
  lines.push("The same trials with a perfect transcription.");
  lines.push("");
  lines.push("| Visible questions (k) | MATCH, correct centre | INCONCLUSIVE | MATCH, wrong centre |");
  lines.push("|---|---|---|---|");
  for (const k of KS) {
    const t = clean.get(k)!;
    lines.push(`| ${k} | ${t.correct} (${pct(t.correct, t.trials)}) | ${t.inconclusive} (${pct(t.inconclusive, t.trials)}) | ${t.wrong} |`);
  }
  lines.push("");
  lines.push("## Fake leaks");
  lines.push("");
  lines.push(`Papers printed from a codebook that is not this exam's (same questions, different secret order/options/wording), with the same noise, matched against the exam's codebook. ${trials} trials per row. Any MATCH here is a false accusation.`);
  lines.push("");
  lines.push("| Fake paper | False MATCH | INCONCLUSIVE | Not this exam |");
  lines.push("|---|---|---|---|");
  for (const k of KS) {
    const t = fake.get(k)!;
    lines.push(`| Other codebook, k = ${k} | ${t.correct + t.wrong} | ${t.inconclusive} (${pct(t.inconclusive, t.trials)}) | ${t.notThisExam} |`);
  }
  lines.push(`| Master paper in master order, all ${n} questions (§12 photo 7) | ${mo.correct + mo.wrong} | ${mo.inconclusive} (${pct(mo.inconclusive, mo.trials)}) | ${mo.notThisExam} |`);
  lines.push("");
  if (falseMatches.length > 0) {
    lines.push("### Every false match");
    lines.push("");
    lines.push("| Row | Trial | Exam codebook | Fake paper from | Attributed to | Matched / observed | Runner-up |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const m of falseMatches) {
      lines.push(`| ${m.row} | ${m.trial} | ${m.codebook} | ${m.source} | centre ${m.centre} | ${m.matched} / ${m.observed} | ${m.runnerUp !== undefined ? `centre ${m.runnerUp} with ${m.runnerUpMatched}` : "–"} |`);
    }
    lines.push("");
  }
  lines.push("## Digital leaks: seat-level tracing (D9)");
  lines.push("");
  lines.push(`A random seat's copy (${SEATS} seats per centre; each seat's copy differs from its centre's printed copy in 8 features), k random questions visible, the same noise as above. Traced with the codebook and the seat file: centre first, then seat (seat lead ≥ ${SEAT_MIN_LEAD}). ${trials} trials per row.`);
  lines.push("");
  lines.push("| Visible questions (k) | Right centre and right seat | Right centre, seat not determined | INCONCLUSIVE | Wrong centre | Wrong seat |");
  lines.push("|---|---|---|---|---|---|");
  for (const k of KS) {
    const t = seatT.get(k)!;
    lines.push(`| ${k} | ${t.rightSeat} (${pct(t.rightSeat, t.trials)}) | ${t.centreOnly} (${pct(t.centreOnly, t.trials)}) | ${t.inconclusive} (${pct(t.inconclusive, t.trials)}) | ${t.wrongCentre} | ${t.wrongSeat} |`);
  }
  lines.push("");
  lines.push("Printed (centre) papers traced with the seat file loaded, same trials per row: a seat must never be named.");
  lines.push("");
  lines.push("| Visible questions (k) | Seat named (must be 0) | Right centre | Wrong centre |");
  lines.push("|---|---|---|---|");
  for (const k of KS) {
    const t = printedSeat.get(k)!;
    lines.push(`| ${k} | ${t.seatNamed} | ${t.rightCentre} (${pct(t.rightCentre, t.trials)}) | ${t.wrongCentre} |`);
  }
  lines.push("");
  lines.push("## What this does and does not show");
  lines.push("");
  lines.push("- It measures the deterministic matcher on synthetic transcriptions with the §10 noise model. It does not measure the vision model: real photos are tested separately (`docs/QA.md`, §12 photos 1–7).");
  lines.push("- A small number of visible questions is often INCONCLUSIVE by design: the matcher prefers saying \"not enough evidence\" to naming the wrong centre.");
  lines.push("- Attribution identifies the centre, not a person. Someone who deliberately retypes and reshuffles a paper can defeat it (§15).");
  lines.push("");

  const out = opts.out ? path.resolve(process.env.INIT_CWD ?? process.cwd(), opts.out) : path.join(ROOT, "docs", "SIMULATION.md");
  writeFileSync(out, lines.join("\n"));
  console.log(`\nMATCH-wrong: ${totalRealWrong} of ${totalRealTrials} · fake false matches: ${totalFakeMatch} of ${totalFakeTrials} · ${secs} s`);
  console.log(`Wrote ${rel(out)}`);
  console.log(`seat level: wrong seat or centre ${totalWrongSeat} of ${totalSeatTrials} · printed given a seat or wrong centre ${totalPrintedSeat} of ${totalPrintedTrials}`);
  return totalRealWrong === 0 && totalFakeMatch === 0 && totalWrongSeat === 0 && totalPrintedSeat === 0 ? 0 : 2;
}
