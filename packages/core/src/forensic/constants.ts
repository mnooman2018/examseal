// Matcher thresholds (CLAUDE.md §10). Every value below is the §10 default.
// None has been tuned yet: `ops simulate` (docs/SIMULATION.md) must confirm MATCH-wrong = 0 and
// fake false-match = 0 before any change, and each change must cite the simulation row that
// justified it (§10). Until then the source for each is "§10 default".

export const MATCHER_VERSION = "examseal-matcher/1";

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

/** decide: fewer observed features than this → INCONCLUSIVE (§10 default). */
export const MIN_OBSERVED_FEATURES = 4;
/** decide: best.matched / observed must be at least this, as integer percent (§10 default: 0.85). */
export const MIN_MATCH_PERCENT = 85;
/** decide: best must lead the runner-up by at least max(MIN_LEAD, ceil(LEAD_FRACTION_PERCENT% × observed)) (§10 default). */
export const MIN_LEAD = 3;
export const LEAD_FRACTION_PERCENT = 30;
