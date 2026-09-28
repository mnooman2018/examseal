# ExamSeal: Status

Owner: Sampurna. Updated at every gate.

**H0 = 21:43 on Mon 28 Sep 2026.** All times below are local clock times. Times after midnight are on Tue 29 Sep.

## Gates

| Gate | H-mark | Clock time | What must be true | Status |
|---|---|---|---|---|
| G0 | H1 | 22:43 (28 Sep) | A real testnet transaction from our repo; BridgeKey signing on localhost | **Done** (Nooman) |
| G1 | H4 | 01:43 (29 Sep) | `ExamSealRegistry` deployed and verified on testnet; all contract tests green | **Done** (merged to main 39d459c) |
| G2 | H4–H5 | 01:43–02:43 | Core round trip (encrypt → split → seal → open any 3 → decrypt); 2 pieces fail; TS commitments equal Solidity | **Done** (65 core tests incl. Solidity cross-check) |
| G3 | H10 | 07:43 | MVP end to end on testnet (seed → rejected early release → 3 releases → decrypt → trace → evidence → revoke). If this slips past H12 (09:43), apply the cut list | **Done** (exam 3, Centre 14; see log) |
| G4 | H14 | 11:43 | Public link works on a phone; attack checklist passes. **Feature freeze** | Pending |
| G5 | H20 | 17:43 | Video recorded, README complete. **Code freeze**, tag `v1.0` | Pending |
| G6 | H22 | 19:43 | Submission form sent, reel posted | Pending |

## Deployment

- **Site (permanent link):** https://examseal-one.vercel.app
- `ExamSealRegistry` on MST Testnet: [`0x6F43B9891B642cCBf674FF4E33FdAcFEDDF41d37`](https://testnet.mstscan.com/address/0x6F43B9891B642cCBf674FF4E33FdAcFEDDF41d37) (verified).
- **Exams 1 and 2 on the registry are test exams.** The first `pnpm ops seed` will create exam 3.

## Other deadlines

| H-mark | Clock time | Deadline |
|---|---|---|
| H2 | 23:43 (28 Sep) | Master paper uploaded to `demo-data/master-paper.json` |
| H6 | 03:43 (29 Sep) | `ops seed` creates a real demo exam on testnet |
| H8 | 05:43 | First Vercel deploy |
| H24 | 21:43 (29 Sep) | End of buildathon |

## Sleep rotation

| Window | Clock time | Asleep |
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
