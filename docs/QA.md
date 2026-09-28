# ExamSeal QA
## Hosted Application

**URL:** https://examseal-one.vercel.app/

## Manual QA Checklist

| # | Test | Expected Result | Status | Evidence |
|---|---|---|---|---|
| 1 | Centre with 1/5 release | Centre cannot unlock paper | NOT TESTED | |
| 2 | Centre with 2/5 releases | Centre cannot unlock paper | NOT TESTED | |
| 3 | Attempt early release | Transaction is rejected; failed tx visible on MSTScan | NOT TESTED | |
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
