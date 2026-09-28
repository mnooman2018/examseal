# Decisions

One entry per decision or new dependency: what, why, alternative rejected.

## D1: Use the Gemini extractor provider (H0)

- **What:** `/api/extract` and `ops check-extractor` use `EXTRACTOR_PROVIDER=gemini`, with the key in `GEMINI_API_KEY` (server-side only).
- **Why:** the team has no Anthropic API credits. A Claude.ai subscription does not include API access (CLAUDE.md §10). Gemini offers a free-tier vision model.
- **Rejected:** `claude` provider (no credits); `manual` provider as the main path (it is not AI and must always carry a "Manual transcription" badge; it stays as a fallback only).
- **Model:** `gemini-3.8-flash` via the REST `models/{model}:generateContent` endpoint (plain `fetch`, no SDK). It is the newest stable Gemini model with image input and a free tier on ai.google.dev (models + pricing pages, checked 28 Sep 2026). Override with `GEMINI_MODEL` in `.env.local` if quotas bite (`gemini-3.5-flash` is also free). `maxOutputTokens` is 8192, not 4000, because Gemini thinking tokens count toward it.
- **Rules unchanged:** the model only transcribes text with the exact §10 prompt; its output is validated with zod; all matching is deterministic and runs in the browser.

## D2: examseal-core dependencies (H0)

- **What:** `shamir-secret-sharing@0.0.4`, `@noble/curves@1.9.7`, `@noble/hashes@1.8.0` (exact pins from CLAUDE.md §7), `viem@2.56.9` (the version the frontend already resolves, so there is one copy in the bundle), and `vitest@5.0.2` for tests.
- **Why:** §7 names these libraries; vitest is the test runner named in §4 and §13.
- **Rejected:** noble 2.x (ESM-only, §7 says do not upgrade); jest (slower TS setup, no benefit here).

## D3: examseal-ops runtime (H0)

- **What:** `tsx@4.23.15` runs the ops scripts; `dotenv@16.6.1` (same version the contracts package already resolves) loads `.env.local`. `esbuild` (a tsx dependency) is added to `allowBuilds` in `pnpm-workspace.yaml` because pnpm 12 blocks its install script otherwise. `examseal-core` is now `"type": "module"` so Node's ESM loader sees its named exports.
- **Why:** CLAUDE.md §2 says ops scripts run with tsx + viem, not `hardhat run`.
- **Rejected:** `ts-node` (slow, ESM friction); dotenv 17+ (prints injection logs by default).

## D4: zod in examseal-core (H0)

- **What:** `zod@3.25.76` in `examseal-core`, holding `ExtractionSchema` and the §10 system prompt (`forensic/extraction.ts`).
- **Why:** §10 requires zod validation of the extractor output. Keeping the schema and prompt in core means `ops check-extractor` and `/api/extract` use one copy.
- **Rejected:** a hand-written validator (more code, easier to get wrong); zod 4 (newer API, no benefit for one schema).

## D5: ops seed dependencies and local end-to-end test (H1)

- **What:** `examseal-ops` now depends on `viem@2.56.9` (same version as core and frontend) and `examseal-shared` (registry address and ABI; never hand-copied). `scripts/e2e-local.ts` tests seed against a local Hardhat node.
- **Why:** §2 says ops scripts use tsx + viem. The local test exercises the full lifecycle (early release rejected, 2/5 locked, 3/5 authorizes, all centres decrypt from on-chain data, reveal) without spending testnet funds or creating testnet exams.
- **Rejected:** hand-writing the ABI in ops (could drift from the deployed contract); testing seed on testnet (would burn exam ids and faucet funds).

## D6: Gemini retries and model fallback (H3)

- **What:** `extractWithGemini` retries 503/429/5xx up to 3 times per model (waits 1 s, 2 s; a longer server-requested wait skips to the next model), then falls back through the free stable vision models: `GEMINI_MODEL` first, then `gemini-3.8-flash`, `-3.7-flash`, `-3.6-flash`, `-3.5-flash`, `-3.1-flash-lite`, `-3.5-flash-lite`. A model not found or not allowed for the key is skipped. Invalid output still gets exactly one retry (§10); bad key / bad image stop at once. The route has a 50 s budget (maxDuration 60 s). Every error names the model.
- **Why:** on 29 Sep both `gemini-3.5-flash` and `gemini-3.8-flash` returned `503 UNAVAILABLE: high demand` for minutes; the single immediate retry failed straight through. With fallback, `check-extractor` on a test photo succeeded on `gemini-3.7-flash` (8 calls, 33.6 s).
- **Rejected:** the 2.5 series (Google now limits it to accounts that used it before); preview models (unstable); longer waits on one model (a demo can't sit for 30 s+ on a quota delay).

## D7: Groq as the last-resort extractor provider (H3)

- **What:** if every Gemini model fails, `/api/extract` (and `ops check-extractor`) tries Groq's `qwen/qwen3.8-27b` with the same §10 system prompt and the same zod check (`GROQ_API_KEY`, optional `GROQ_MODEL`; server-only). Call: OpenAI-compatible chat completions, photo as a `data:` URL, JSON mode with `reasoning_format: "hidden"` and `reasoning_effort: "none"`, temperature 0. Retries and fallbacks now live in one provider-neutral function (`extractWithFallback`); Groq keeps 15 s of the route's 50 s budget so a slow Gemini can't starve it. A fatal Gemini error (e.g. bad key) also falls through to Groq. The result names the provider and model; `EXTRACTOR_PROVIDER=groq` uses Groq only. No new dependency (plain `fetch`).
- **Why:** on 29 Sep several Gemini models returned 503 "high demand" for minutes. A second, independent provider keeps the live demo's trace step working. Groq docs (vision, models, rate-limits pages, checked 29 Sep 2026): `qwen/qwen3.8-27b` is the only vision model and is on the free plan (30 RPM, 1K RPD, 8K TPM; an image costs 2,048 tokens, so about 2 photos a minute).
- **Tested 29 Sep on `C:\Dev\trace-test.png` — Groq did NOT read the image.** Six request variants (image only / with a user text line / prompt in the user turn instead of a system message / PNG / JPEG / reasoning on and off) all returned a fluent, schema-valid transcription of an **invented** paper (database questions; 0 of 12 questions matched the photo), and every request used about 960 prompt tokens in total, although Groq counts 2,048 per image. Only the numbering 1–12 and labels A–D matched, which a model can guess.
- **Guard (so this can never mislead a trace):** a Groq reply whose `usage.prompt_tokens` is below 2,048 is discarded as "did not read the image" and reported like any unavailable model. Without the guard, a fabricated transcription of a real leak would have produced "Not this exam". If Groq starts reading images, the fallback starts working with no code change.
- **Other limits found:** the free plan also caps **output at 1,000 tokens/minute**; a request with a larger `max_completion_tokens` is refused as "Request too large" (not retried). The cap is now 1,000 (a 12-question transcription is ~730 tokens), so at most about one Groq photo per minute.
- **Caveats (said openly):** Groq marks this model **preview**, "may be discontinued at short notice". Right now Groq does **not** rescue a Gemini outage for us; it fails safely instead. The leaked photo is sent to a second third-party service when Gemini fails. The model only transcribes; matching stays deterministic and in the browser.
- **Rejected:** other Groq models (no image input); a Groq SDK (extra dependency for one call).

## D8: Matcher thresholds tuned by simulation (Phase 3)

All numbers below come from `pnpm ops simulate` (1,000 trials per row: 6,000 real leaks with §10 noise and 7,000 fake leaks per seed, 5 exam codebooks × 20 centres, public seeds, never the demo codebook). "k" = visible questions; percentages are real leaks attributed to the correct centre.

- **§10 defaults (85%, ≥ 4 features), seed v1:** MATCH-wrong 0 of 6,000 but **1 false match in 7,000**: a fake paper (k = 6, fake codebook 0, centre 18) attributed to real centre 8 at 8 of 9 features, runner-up 4. Target missed.
- **Single changes on seed v1** (all reached 0 wrong / 0 false):
  - C1 lead ≥ 5: k=3 20.4%, k=4 68.3%. Too costly.
  - C2 match ≥ 90%: k=2 36.7%, k=3 83.0%, k=4 96.5%. Almost free.
  - C3 ≥ 10 features: k=3 0%, k=4 52.5%. Too costly.
- **C2 on held-out seeds:** v3 clean; **v2 had 1 false match**: a fake (k = 4, fake codebook 4, centre 19) attributed to real centre 3 at **7 of 7** features, runner-up 4. No percentage can stop a 100% agreement; the cause is thin evidence (7 features, several of them coin-flip wordings).
- **Combinations on seeds v1, v2, v3** (all 0 wrong in 18,000, 0 false in 21,000):
  - D1 90% + lead ≥ 4: k=2 ~7%, k=3 ~55%, k=4 88–91%.
  - D2 90% + ≥ 8 features: k=2 0%, k=3 38–39%, k=4 92–94%.
- **Chosen: D2** (`MIN_MATCH_PERCENT` 85 → 90, `MIN_OBSERVED_FEATURES` 4 → 8; lead unchanged). It is stronger where realistic partial leaks sit (k ≥ 4), and its rule is easy to state: never name a centre on fewer than 8 visible features. Cost: 2 visible questions are always INCONCLUSIVE, 3 are named about 4 times in 10.
- **Held-out check of D2 on fresh seeds v4, v5** (not used for choosing): 0 wrong in 12,000, 0 false in 14,000; k=3 39.9% / 41.8%, k=4 94.7% / 94.5%. Across v1–v5: 0 wrong in 30,000 real leaks, 0 false matches in 35,000 fake leaks.
- `MATCHER_VERSION` bumped to `examseal-matcher/2`; evidence reports record it, so exam 3's report (made with /1) stays verifiable.
- **Rejected:** C1, C3 (large loss at k = 3–4); D1 (weaker at k = 4); changing the matcher algorithm itself (§10 fixes the method; only thresholds are tuned).

## D9: Per-seat variants and digital exams (stretch, 29 Sep ~02:30)

- **Why:** the mentor asked for (1) tracing a leak to the individual candidate (centre + seat), not just the centre, and (2) digital computer-based exams (JEE-style), where leaks are screenshots or retyped text, alongside printed papers (NEET-style).
- **Approval for Nooman to review:** Sampurna (integration owner) approved, while Nooman was asleep, adding **one new route** in `packages/frontend` for the digital exam page. No existing page is changed; it only imports existing helpers. CLAUDE.md §3 gives that folder to Nooman, so please review it in the morning.
- **Unchanged (hard rules):** the contract and the §6 interface; the per-centre flow; how the per-centre codebook is generated from `DEMO_CODEBOOK_SEED` (so the Centre 14 printouts and exams 3 and 4 keep working); every §7 file format; the §8 `EvidenceReport` / `Decision` types.
- **Seat layer** (`packages/core/src/candidate.ts`): a seat's copy is its centre's copy with exactly 8 feature changes (1 question pair swapped = 2 positions, 3 option orders, 3 wordings); any two seats of a centre differ in at least 6 features. The seat seed is HKDF-SHA256 over the centre's X25519 private key, so the centre (digital page, from its key file) and the authority (`ops candidates`, from the seed's key files) derive the same seats without any new secret or format change. Seat codes live only in the authority's secret files (`candidates.secret.json`, gitignored).
- **Decision** (`forensic/seat.ts`): centre first, with the existing §10 thresholds applied to each centre's best code (printed copy or any seat), so printed leaks behave exactly as before. A seat is named only within the matched centre, if it reaches 90% with ≥ 8 features and leads both the next seat and the centre's printed copy by `SEAT_MIN_LEAD`. Otherwise the result is the centre only. The on-chain record stays per centre (`recordLeak` takes a centre); the seat is written in the evidence report's reason text, which is part of the hashed report (§8 stays frozen, option (a)).
