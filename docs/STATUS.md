# ExamSeal: Status

Owner: Sampurna. Updated at every gate.

**H0 = 21:43 on Mon 28 Sep 2026.** All times below are local clock times. Times after midnight are on Tue 29 Sep.

## Gates

| Gate | H-mark | Clock time | What must be true | Status |
|---|---|---|---|---|
| G0 | H1 | 22:43 (28 Sep) | A real testnet transaction from our repo; BridgeKey signing on localhost | Pending |
| G1 | H4 | 01:43 (29 Sep) | `ExamSealRegistry` deployed and verified on testnet; all contract tests green | Pending |
| G2 | H4–H5 | 01:43–02:43 | Core round trip (encrypt → split → seal → open any 3 → decrypt); 2 pieces fail; TS commitments equal Solidity | Pending |
| G3 | H10 | 07:43 | MVP end to end on testnet (seed → rejected early release → 3 releases → decrypt → trace → evidence → revoke). If this slips past H12 (09:43), apply the cut list | Pending |
| G4 | H14 | 11:43 | Public link works on a phone; attack checklist passes. **Feature freeze** | Pending |
| G5 | H20 | 17:43 | Video recorded, README complete. **Code freeze**, tag `v1.0` | Pending |
| G6 | H22 | 19:43 | Submission form sent, reel posted | Pending |

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
