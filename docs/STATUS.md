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
| G3 | H10 | 07:43 | MVP end to end on testnet (seed → rejected early release → 3 releases → decrypt → trace → evidence → revoke). If this slips past H12 (09:43), apply the cut list | **Done** (exam 3, Centre 14; evidence + revoke verified on-chain, see log) |
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

## For Nooman (morning)

- **`/digital` needs a header link.** The new digital exam page (D9, approved by Sampurna for your review) is merged to `main` but is only reachable by URL, because adding it to the nav would edit your `components/SiteHeader.tsx`. Please add a "Digital" entry to `NAV` there (and review `app/digital/page.tsx`, which only imports your hooks, `lib/*` and components; nothing of yours was changed).
- **Redeploy Vercel** from `main` so the hosted site gets `/digital` and the new `/trace` (paste leaked text, seat-level results). Needs to happen before the 07:00 feature freeze or be counted as a bug-fix deploy before the 10:00 code freeze.

### Style brief for your pages: MST dashboard look (D11 → D12 → D13)

**Updated 06:52: D13 replaces parts of the earlier brief.** Sampurna is building the whole-app dashboard on `sampurna/ui-v2` (D12; app shell, control room dashboard, /trace console) in this look. **Please review that branch before restyling anything yourself**, so the work is not done twice. Tokens: `packages/frontend/app/globals.css` on that branch.

| Element | Rule |
|---|---|
| Background | Near-black `#0A0A0B` with a soft dark-red radial glow behind the content. No 3D art |
| Cards | About 10px corners, faint 1px border (`rgba(255,255,255,0.07)`), subtle top-to-bottom dark gradient, soft shadow |
| Type | Title Case headings and nav in Inter (600–700), normal letter spacing. Only tiny labels are uppercase. Mono (JetBrains Mono) for hashes, addresses, block numbers |
| Brand crimson | `#C8102E`, sparingly: primary buttons, the active nav pill, chart line, key numbers, hash links |
| Sidebar | Line icons (inline SVG) + Title Case labels; active item is a dark-red pill with a crimson border |
| KPI cards | Icon badge on the right with a soft glow in the state colour |
| Charts | Red line with a red gradient fill underneath, faint grid |
| Tables | Event types as small rounded pill badges (green released, red revoked/leak, grey routine); hash links in red |
| Top bar | Exam picker and block number as rounded pills |

**Status (unchanged, never the brand colour):** SEALED steel grey `#8B95A1` · RELEASE OPEN amber `#F0A830` · RELEASED green `#3FBF6F` · **COMPROMISED red `#FF4D4F` with diagonal stripes** (`repeating-linear-gradient(135deg, #B3262A 0 8px, #5E1113 8px 16px)`), also on the DO NOT USE banner.
**Footer:** "Built on MST Blockchain" as plain text, with chain id and registry.

## G4 plan (checked 02:25)

§13 rows in `docs/QA.md` already PASS: 1, 2, 3, 13, 14 (iPhone), 16, 17, 18. Hosted-site machine checks PASS (see log 02:25). Remaining:

**A. Finish G3 + QA rows 19 and 5: DONE (verified on-chain; see log).** Step 7 (DO NOT USE banner on `/centre`) is still a human check.
1. Chrome "Authority" profile. The connected wallet must be **0xC028f228E2B0697d0EaA63f4C818de205c1fE0Ef** (exam 3's authority; `/trace` step 1 shows it).
2. Open https://examseal-one.vercel.app/trace?exam=3. Load `demo-data/master-paper.json`, then `demo-data/secrets/exam-3/codebook.secret.json`.
3. Choose a Centre 14 photo (`C:Dev	race-test.png` works) → **Transcribe the photo** → expect "Leak traced to Centre 14".
4. In "4 · Accountability on MST" there must be **no** yellow "not this exam's authority" banner (if there is, switch wallet). Click **Record evidence on MST** → sign → wait for "confirmed in block N" → copy the MSTScan link into QA row 19.
5. Click **Revoke Centre 14** → sign → confirmed → red DO NOT USE banner. Copy the link.
6. Check `/?exam=3` (Centre 14 tile red, COMPROMISED) and `/exam/3` (timeline shows LeakRecorded and CentreRevoked).
7. Row 5: open `/centre`, load `demo-data/secrets/exam-3/centres/centre-14.centrekey.secret.json` → red DO NOT USE banner, Unlock disabled. (The contract skipping releases for a revoked centre with reason 1 is covered by contract test "compromised → skipped(1)"; the site and `ops release` deliberately never send a release for a revoked centre.)

**B. QA row 4, wrong centre key file: any time before 07:00**
1. `/centre`: load a **custodian** file (e.g. from `demo-data/secrets/exam-4/custodians/`) → expect "Missing centreId. Is this a centre key file?" and no crash.
2. Copy `exam-4/centres/centre-14.centrekey.secret.json` to `centre-14-TAMPERED.centrekey.secret.json` in the same folder (gitignored). Change one hex digit **in the middle** of `x25519PrivateKey` (X25519 ignores a few bits at the very start and end, so an edge digit may change nothing). Load it → Centre 14 is Released 3/5 → **Unlock paper** → expect ✗ at "Open pieces and rebuild the key" with "Not enough valid pieces: 0 opened, 3 needed (3 could not be opened)", nothing decrypted, no crash. Delete the copy afterwards.

**C. QA row 15, projector: any time before 07:00**
Laptop at 1280×720 (display settings, or Chrome DevTools → device toolbar → Responsive 1280×720), zoom 100%. Open `/?exam=4`, `/exam/4` and a `/trace` result. Pass if every number, status and the result sentence are readable from the back of the room and nothing needs horizontal scrolling.

**D. QA rows 6–12, leak photos: 08:00–10:00 (testing only, no code)**
For each photo in `demo-data/leaks/`: `/trace?exam=4` → load the master paper and any demo exam's `codebook.secret.json` (all demo exams share the demo codebook) → choose the photo → Transcribe. Record the result sentence and evidence hash in QA. **Do not click Record or Revoke during photo tests.**
- Expected: photos 1–3 and 6 → Centre 14. Photos 4 and 5 (half pages, about 6 questions) → Centre 14 (`docs/SIMULATION.md`: 6 visible questions matched 1000 of 1000). Photo 7 (master order) → INCONCLUSIVE.
- If a real Centre 14 photo comes out INCONCLUSIVE or NOT_THIS_EXAM, expand "AI transcription" and note what was misread. Report it by **09:15** so any fix lands before the 10:00 code freeze.

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
- G3 (reported earlier as done): seed, rejected early release, custodian releases, Centre 14 decrypted, and a photo of Centre 14's printout traced to Centre 14 (36 of 36 features, locally).
- **02:25 correction: G3 is not complete.** A read of the registry found **no LeakRecorded and no CentreRevoked event on any exam (1–4)**; exam 3 Centre 14 is Released 5/5 with no evidence hash, exam 4 Centre 14 is Released 3/5. MSTScan shows the authority wallet (0xC028…E0Ef) never sent recordLeak or revokeCentre, not even a failed one. The hosted /trace does contain both actions. Most likely the record/revoke was attempted with a non-authority wallet or not signed. To finish G3: on the hosted /trace, connected as the authority wallet, record evidence and revoke Centre 14 (steps in the G4 plan below).
- 02:15: real deadline is 13:00, not 21:43. G4 → 07:00 (feature freeze), code freeze 10:00, G5 → 11:00, G6 → 12:00. Phase 4 stretch cut. Sleep rotation needs redoing.
- Phase 3: `ops simulate` run; `docs/SIMULATION.md` written. Thresholds tuned from it (D8): 0 wrong of 6,000 real leaks, 0 false matches of 7,000 fake leaks on the published run.
- 02:25 G4 machine checks against https://examseal-one.vercel.app: all pages 200; RPC proxy on chain 91562037; /api/extract rejects bad bodies (400), extra fields (400) and cross-origin (403); a real photo transcribed on the hosted site with Vercel's keys (Gemini gemini-3.8-flash, 11.5 s, 12/12 questions agree with the local transcription). Fix on branch sampurna/g4-fixes: ops scripts prefer IPv4 (Node fetch hit ECONNRESET over IPv6 on this laptop).
- 02:28: sampurna/g4-fixes (ops prefer IPv4) merged to main; pnpm test and pnpm build green. QA row 5 on-chain proof skipped by decision: contract test "compromised → skipped(1)" covers it.
- **G3 done (verified on-chain):** Adithi, with the authority wallet 0xC028…E0Ef, recorded the evidence for exam 3 Centre 14 in block 5791620 (36/36, evidence hash 0x78c3cf08…509dbb, equal to the centre's stored lastEvidenceHash) — https://testnet.mstscan.com/tx/0xc883875bc4db86b1137eee12dfa10dbdcf75c24dc9002a94a436c5aee85a7f7c — and revoked Centre 14 in block 5791631 — https://testnet.mstscan.com/tx/0xc615bec80396f70ec08e07efd8502514017573f4775e32fd58f19de477051d38. Centre 14 is now Compromised (5/5). QA row 19 can be marked PASS with the first link.
- 03:20: sampurna/digital (D9 stretch: seat-level tracing, pasted-text leaks, /digital) merged to main after pnpm test (124 core, 29 contract) and pnpm build passed. Live test by Sampurna: text pasted from /digital seat 7 on exam 4 traced to "Centre 14, Seat 7" (36 of 36); the old printed photo still traces to Centre 14 on exam 3.
- 05:56: /trace restyled in the MST look on branch sampurna/trace-style (not merged; Sampurna to check). Style brief for Nooman's pages added above (D11).
- 06:52: D13 recorded (softer dashboard look replaces D11's no-gradient/no-glow/uppercase rules); Nooman's style brief updated.
