// Matcher thresholds (CLAUDE.md §10). Each value says what justifies it. Values changed from the §10
// defaults cite the `ops simulate` runs behind them; the full history is docs/DECISIONS.md D8 and the
// current results are docs/SIMULATION.md. Rerun `pnpm ops simulate` after any change.

export const MATCHER_VERSION = "examseal-matcher/2";

/** identifyQuestions: minimum text similarity to accept a question (§10 default). */
export const QUESTION_MIN_SIMILARITY = 0.55;
/** identifyQuestions: the accepted question must beat every other question by this much (§10 default). */
export const QUESTION_MIN_MARGIN = 0.1;
/** identifyQuestions: wording is decided only if the two wordings' similarities differ by this much (§10 default). */
export const WORDING_MIN_GAP = 0.08;
/** identifyQuestions: minimum similarity to map an extracted option to a master option (§10 default). */
export const OPTION_MIN_SIMILARITY = 0.6;
/** identifyQuestions: options needed (distinct labels and master indices) to infer the 4th by elimination (§10 default). */
export const OPTIONS_NEEDED_FOR_PERM = 3;

/**
 * decide: fewer observed features than this → INCONCLUSIVE.
 * §10 default was 4. Raised to 8 (D8): with 90% alone, seed examseal-sim-v2 still produced a fake
 * leak (k = 4) attributed at 7 of 7 features with a lead of 3. At 8, seeds v1–v5 (30,000 real-leak and
 * 35,000 fake-leak trials) gave 0 wrong and 0 false matches.
 */
export const MIN_OBSERVED_FEATURES = 8;
/**
 * decide: best.matched / observed must be at least this, as integer percent.
 * §10 default was 85. Raised to 90 (D8): at 85, seed examseal-sim-v1 attributed one fake leak (k = 6)
 * to a real centre at 8 of 9 features (1 false match in 7,000).
 */
export const MIN_MATCH_PERCENT = 90;
/** decide: best must lead the runner-up by at least max(MIN_LEAD, ceil(LEAD_FRACTION_PERCENT% × observed)) (§10 default). */
export const MIN_LEAD = 3;
export const LEAD_FRACTION_PERCENT = 30;
