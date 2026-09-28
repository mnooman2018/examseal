# ExamSeal QA

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
