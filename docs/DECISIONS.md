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
