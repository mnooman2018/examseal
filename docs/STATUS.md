# ExamSeal: Status

Owner: Sampurna. Updated at every gate.

**H0 = 21:43 on Mon 28 Sep 2026.** All times below are local clock times (IST). Times after midnight are on Tue 29 Sep.

> **Revised at 02:15 on 29 Sep: the real submission deadline is 13:00 today**, not H24 (21:43). G4–G6 are recomputed below with feature freeze at 07:00 and no code changes after 10:00. The H-marks in CLAUDE.md §4 no longer apply to G4–G6; the clock times here do.

## Gates

| Gate | H-mark | Clock time | What must be true | Status |
|---|---|---|---|---|
| G0 | H1 | 22:43 (28 Sep) | A real testnet transaction from our repo; BridgeKey signing on localhost | **Done** (Nooman) |
| G1 | H4 | 01:43 (29 Sep) | `ExamSealRegistry` deployed and verified on testnet; all contract tests green | **Done** (merged to main 39d459c) |
| G2 | H4–H5 | 01:43–02:43 | Core round trip (encrypt → split → seal → open any 3 → decrypt); 2 pieces fail; TS commitments equal Solidity | **Done** (65 core tests incl. Solidity cross-check) |
| G3 | H10 | 07:43 | MVP end to end on testnet (seed → rejected early release → 3 releases → decrypt → trace → evidence → revoke). If this slips past H12 (09:43), apply the cut list | **Done** (exam 3, Centre 14; see log) |
| G4 | – | **07:00** | Public link works on a phone; attack checklist (§13) passes **on the hosted site**. **Feature freeze** | Pending |
| Code freeze | – | **10:00** | No code changes after this. Tag `v1.0`, final Vercel deploy, `pnpm test` and `pnpm build` green on `main` | Pending |
| G5 | – | **11:00** | Demo video recorded on the frozen v1.0 deploy; README complete (§14 checklist) | Pending |
| G6 | – | **12:00** | Submission form sent (1 h buffer before 13:00); Instagram reel posted | Pending |
| Deadline | – | **13:00** | Hard submission deadline | – |

### Plan to 13:00

| Window | What happens | Allowed changes |
|---|---|---|
| 02:15–07:00 | Finish features; Vercel env vars for `/trace`; test every leak photo (§12 photos 1–7) on the hosted site; attack checklist on the hosted site; deck gets real numbers from `docs/SIMULATION.md` | Features and fixes |
| 07:00–10:00 | Bug fixes only; README finalised; run-book rehearsed at least 3 times | Bug fixes only |
| 10:00–11:00 | Tag `v1.0`; seed a fresh exam; record the demo video (3–4 min) on the frozen deploy | None to code |
| 11:00–12:00 | Check every link in an incognito window; submit the form; post the reel | None to code |
| 12:00–13:00 | Buffer. Rehearse; seed a fresh exam before each judge visit | None to code |

Phase 4 stretch goals (/verify, backup set, create-exam wizard) are **cut** unless G4 is green well before 07:00 (§4: "shrink Phase 4 first"). The never-cut list in §4 is unchanged.

## Deployment

- **Site (permanent link):** https://examseal-one.vercel.app
- `ExamSealRegistry` on MST Testnet: [`0x6F43B9891B642cCBf674FF4E33FdAcFEDDF41d37`](https://testnet.mstscan.com/address/0x6F43B9891B642cCBf674FF4E33FdAcFEDDF41d37) (verified).
- **Exams 1 and 2 on the registry are test exams.** Demo exams seeded so far: 3 (used for G3; Centre 14 revoked) and 4. Every seed is logged in `docs/DEMO_RUNS.md`.

## Other deadlines

| H-mark | Clock time | Deadline |
|---|---|---|
| H2 | 23:43 (28 Sep) | Master paper uploaded to `demo-data/master-paper.json` (**done**) |
| H6 | 03:43 (29 Sep) | `ops seed` creates a real demo exam on testnet (**done**: exam 3) |
| H8 | 05:43 | First Vercel deploy (**done**: https://examseal-one.vercel.app) |
| – | 13:00 (29 Sep) | **Real submission deadline** (replaces H24, 21:43) |

## Sleep rotation

**Superseded at 02:15:** the windows below run past the 13:00 deadline and put people asleep during the video and submission. The team needs to agree a new rotation that fits before 13:00. Constraints: never both Sampurna and Nooman (the two Opus holders) asleep at once; nobody asleep 10:00–12:00 (video, submission); the video recorder (Adithi) awake from 10:00.

| Window (old) | Clock time (old) | Asleep |
|---|---|---|
| H11–H12:30 | 08:43–10:13 | Dhruva |
| H12:30–H14 | 10:13–11:43 | Adithi |
| H15–H16:30 | 12:43–14:13 | Nooman |
| H16:30–H18 | 14:13–15:43 | Sampurna |

## Log

- H0 (21:43): kickoff. Branch `sampurna/core` created.
- G0 and G1 done (Nooman): Hello deployed; ExamSealRegistry deployed and verified; 29 contract tests green. nooman/contract merged to main.
- G2 done: core round trip, 2 pieces fail, and TypeScript fingerprint commitment equals the contract fixture.
- Master paper moved from dhruva/exam.json to demo-data/master-paper.json; validate-paper OK (12 questions).
- G3 done on exam 3: seed, rejected early release, custodian releases, Centre 14 decrypted, a photo of Centre 14's printout traced to Centre 14 (36 of 36 features, locally), then Adithi recorded the evidence and revoked Centre 14 from the live site. Tx links are on the `/exam/3` chain-of-custody timeline.
- 02:15: real deadline is 13:00, not 21:43. G4 → 07:00 (feature freeze), code freeze 10:00, G5 → 11:00, G6 → 12:00. Phase 4 stretch cut. Sleep rotation needs redoing.
- Phase 3: `ops simulate` run; `docs/SIMULATION.md` written. Thresholds tuned from it (D8): 0 wrong of 6,000 real leaks, 0 false matches of 7,000 fake leaks on the published run.
