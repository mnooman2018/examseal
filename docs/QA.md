# ExamSeal QA
## Hosted Application

**URL:** https://examseal-one.vercel.app/

## Manual QA Checklist

| # | Test | Expected Result | Status | Evidence |
|---|---|---|---|---|
| 1 | Centre with 1/5 release | Centre cannot unlock paper | NOT TESTED | |
| 2 | Centre with 2/5 releases | Centre cannot unlock paper | NOT TESTED | |
| 3 | Attempt early release | Transaction is rejected; failed tx visible on MSTScan | PASS | Exam 4: Custodians 1–3 early release attempts rejected with `ReleaseNotStarted` |
| 4 | Wrong centre key file | Clear error; application does not crash | NOT TESTED | |
| 5 | Revoked centre | Further releases skipped; centre shows DO NOT USE | NOT TESTED | |
| 6 | Leak photo 1 | Identified as Centre 14 | NOT TESTED | |
| 7 | Leak photo 2 | Identified as Centre 14 | NOT TESTED | |
| 8 | Leak photo 3 | Identified as Centre 14 | NOT TESTED | |
| 9 | Leak photo 4 | Identified as Centre 14 | NOT TESTED | |
| 10 | Leak photo 5 | Identified as Centre 14 | NOT TESTED | |
| 11 | Leak photo 6 | Identified as Centre 14 | NOT TESTED | |
| 12 | Fake leak photo 7 | INCONCLUSIVE | NOT TESTED | |
| 13 | Refresh during flow | State recovers from blockchain | NOT TESTED | |
| 14 | Phone view | Usable | NOT TESTED | |
| 15 | Projector view | Readable | NOT TESTED | |
| 16 | Explorer links | Each link opens the correct MSTScan transaction | NOT TESTED | |
| 17 | Three custodians released | 3/5 reached; RELEASE AUTHORIZED | NOT TESTED | |
| 18 | Centre 14 unlock | Commitment verified; paper successfully unlocked | NOT TESTED | |
| 19 | Record leak evidence | Evidence recorded successfully; transaction visible on MSTScan | NOT TESTED | |

## G0 — Wallet / Testnet Proof

| Check | Status | Evidence |
|---|---|---|
| Authority wallet signed Hello.setMessage | PASS | 0x5506785ef7addaddef0cef47aed2329c8f33a798c2a7f6949c575b4540af2530 |
| Hello.setMessage transaction confirmed on MST Testnet | PASS | https://testnet.mstscan.com/tx/0x5506785ef7addaddef0cef47aed2329c8f33a798c2a7f6949c575b4540af2530 |

## Exam 4 — Early Release Test

| Custodian | Test | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| Custodian 1 | Attempted release before 00:08 | Transaction rejected with `ReleaseNotStarted` | Release rejected before release time | PASS |
| Custodian 2 | Attempted release before 00:08 | Transaction rejected with `ReleaseNotStarted` | Release rejected before release time | PASS |
| Custodian 3 | Attempted release before 00:08 | Transaction rejected with `ReleaseNotStarted` | Release rejected before release time | PASS |

### Exam 4 Early Release Notes

All three pre-release attempts were rejected as expected with `ReleaseNotStarted`.

No successful share release occurred before the scheduled release time.

## Exam 3 — Centre 14 Verification

| Check | Status | Evidence |
|---|---|---|
| Centre 14 key file loaded | PASS | Centre 14 page loaded successfully |
| Centre 14 public key matched key file | PASS | Public key matched |
| Centre 14 release threshold | PASS | 3/5 approvals required |
| Centre 14 approvals observed | PASS | 5/5 approvals |
| Centre 14 status | PASS | RELEASED |
| Sealed pieces read from chain | PASS | 5 sealed pieces on-chain |
| Encrypted copy fetched | PASS | Ciphertext fetched from block 5787003 |
| Variant commitment verification | PASS | Commitment matched |
| Centre 14 browser decryption | BLOCKED | Decryption module not merged into deployed build |

### Exam 3 Centre 14 Decryption Blocker

The Centre 14 page successfully reached the release, sealed-piece, ciphertext, and commitment verification stages.

Observed release state:

- Required threshold: 3/5
- Approvals: 5/5
- Centre status: RELEASED
- Sealed pieces on-chain: 5

The deployed build then displayed:

`Waiting on examseal-core (Sampurna): the decryption module is not merged into this build yet.`

Therefore the Centre 14 paper could not be decrypted in the deployed build at the time of testing.

Status: BLOCKED
