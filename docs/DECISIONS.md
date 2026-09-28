# Decisions

One entry per decision or new dependency: what, why, alternative rejected.

## D1: Use the Gemini extractor provider (H0)

- **What:** `/api/extract` and `ops check-extractor` use `EXTRACTOR_PROVIDER=gemini`, with the key in `GEMINI_API_KEY` (server-side only).
- **Why:** the team has no Anthropic API credits. A Claude.ai subscription does not include API access (CLAUDE.md §10). Gemini offers a free-tier vision model.
- **Rejected:** `claude` provider (no credits); `manual` provider as the main path (it is not AI and must always carry a "Manual transcription" badge; it stays as a fallback only).
- **Rules unchanged:** the model only transcribes text with the exact §10 prompt; its output is validated with zod; all matching is deterministic and runs in the browser.
