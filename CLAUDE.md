# CLAUDE.md: ExamSeal (MST × Newrro Buildathon)

> Read this whole file at the start of every session. It is the single source of truth for the project.
> If a request conflicts with this file, stop and ask the human before doing anything.

---

## 0. What we are building (30-second version)

**ExamSeal: exam papers that no single person can open early, and that trace any leak back to the centre it came from.**

- **LOCK.** Every exam centre gets its own encrypted copy (AES-256-GCM). Each copy's key is split 3-of-5 (Shamir) among custodians. At exam time, custodians release their pieces *through the MST contract*, which rejects anything before the release time. Pieces are encrypted so only that centre can read them. The key is rebuilt only in the centre's browser; no server ever holds it.
- **TRACE.** Every centre's copy is secretly unique: question order, option order, and one of two wordings per question. A leaked photo goes to a vision model that *only transcribes text*, then a deterministic matcher reports something like: "Centre 14: 31 of 33 observed features match. Next closest: Centre 06 with 9."
- **PROOF.** Exam creation, encrypted copies, releases, leak evidence, revocations, and fingerprint reveals are all real transactions on MST Testnet. Anyone can verify them on MSTScan.

**Pitch line (keep all UI copy and README consistent with it):**
> "Every system tries to lock the paper. But on exam morning, someone always has it in their hands. So we lock it so no one person can open it early, and we make every copy traceable, so if it leaks, we know exactly where from, with proof nobody can erase."

**Why blockchain (one sentence):** the organisation responsible for the exam must not be able to silently rewrite the evidence after a leak. MST holds the commitments and release events; the key only comes together at the centre, at exam time.

---

## 1. Non-negotiable rules

1. **Real on-chain data only.** Never mock, hard-code, or simulate a transaction hash, address, event, or block. The official guide can disqualify projects for fake or misleading transaction data. If the chain is unreachable, the UI shows an error. It never pretends.
2. **Numbers are computed, never invented.** No "AI confidence 99.2%". Every number on screen comes from code: feature counts, ratios, or simulation output. The LLM only transcribes text.
3. **Never write "leak-proof", "unhackable", "100% secure", or "tamper-proof"** anywhere (UI, README, comments, commit messages). Use: *tamper-evident, threshold-released, traceable*.
4. **Secrets never touch git.** That includes private keys, AES keys, centre private keys, custodian files, fingerprint salts, the codebook seed, and API keys. They live only in `.env.local` or `demo-data/secrets/` (gitignored). Run `git status` before every commit and check.
5. **Stay in your lane.** Only edit files in the directories owned by the person you are working for (§3). If a change is needed elsewhere, write down exactly what is needed and tell the human; don't make it yourself.
6. **Frozen interfaces** (§6 contract interface, §7 byte formats, §8 core API) change only when Sampurna and Nooman both agree, and this file is updated in the same commit.
7. **Feature freeze at H14. Code freeze at H20.** After freeze: bug fixes only.
8. **Small commits** with prefixes: `feat(core):`, `fix(web):`, `test(contracts):`, `docs:`. Run the relevant tests before committing. `main` must always build.
9. **Boring, proven code over clever code.** No new dependency without a one-line entry in `docs/DECISIONS.md` (what, why, alternative rejected).
10. **Don't guess MST behaviour.** Check the scaffold code, test against testnet, or ask.
11. **Never paste private keys or API keys into any chat**, including Claude and ChatGPT. Refer to them by env var name.

---

## 2. Network and tooling facts (verified from the official VibeKit scaffold)

| Item | Value |
|---|---|
| Network | MST Testnet: EVM-compatible, PoSA, ~3 s blocks, tiny fees |
| Chain ID | `91562037` |
| RPC | `https://testnetrpc.mstblockchain.com` (server-side only, see CORS below) |
| Explorer | `https://testnet.mstscan.com` (Blockscout). Tx: `/tx/<hash>`, address: `/address/<addr>` |
| Faucet | `https://faucet.masterstroke.academy` |
| Wallet | BridgeKey Chrome extension, expected to appear as an injected EIP-1193 wallet |
| Scaffold | `npx create-mst-app examseal --template blank --pm pnpm --git --yes` |
| Stack from scaffold | pnpm workspaces + turbo; Hardhat (Solidity 0.8.20, OpenZeppelin 5.0); Next.js 14 App Router; wagmi 2.12 + viem 2; react-query |
| Deploy output | Addresses + ABIs are auto-written to `packages/shared/src/contracts.ts` and `packages/contracts/deployments.json` |
| Verify | `pnpm verify:testnet` (Blockscout; `MSTSCAN_API_KEY` can be any non-empty string if no key is issued) |

**Known pitfalls. Read before writing chain code:**

- **CORS:** the testnet RPC sends no CORS headers. **All browser reads must go through the same-origin proxy `/api/rpc/testnet`** (already in the scaffold; wagmi transports use it). Any new viem `publicClient` created in the browser must use `http("/api/rpc/testnet")`. Server-side code and ops scripts can call the RPC directly.
- **Compiler:** keep the scaffold's Solidity 0.8.20. If deployment fails with an invalid-opcode error, set `evmVersion: "paris"` in `hardhat.config.ts` and redeploy.
- **Time:** use **chain time** (latest block timestamp) for countdowns and release checks, never the laptop clock.
- **Showing a rejected transaction on MSTScan:** wallets simulate first and refuse to send a transaction that will fail. The "Attempt early release (demo)" button therefore passes an explicit `gas: 500_000n` so the reverted transaction is mined and visible. **Test this once on testnet in Phase 1.** If BridgeKey still refuses, show the decoded revert reason in the UI instead, and say so.
- **Logs:** never call `eth_getLogs` over huge ranges. Use the block numbers stored in the contract (`createdBlock`, `registeredBlock`). For wider ranges, chunk by 2,000 blocks with retry.
- **BridgeKey:** Adithi confirms in H0–H1 that it shows up under wagmi's `injected()` connector. Fallback: MetaMask with MST Testnet added manually (MST states MetaMask compatibility). Use **one Chrome profile per role** (Authority, Custodian 1, 2, 3) to avoid extension conflicts.
- **BigInt:** use a JSON replacer when serialising; never `JSON.stringify` raw bigint.
- **ESM/CJS:** ops scripts run with `tsx` and viem, not `hardhat run`, so ESM-only packages never break them. Hardhat is used only for compile, test, deploy, and verify.

---

## 3. Team, tools, and ownership

| Person | AI tools | Role | Owns (only edits these) |
|---|---|---|---|
| **Sampurna** | Opus 5.5 (Claude Code) | Tech lead and **integration owner**. Crypto, variants, forensics, ops scripts. Merges to `main` at each gate. | `packages/core/`, `packages/ops/`, `packages/frontend/app/trace/`, `packages/frontend/app/api/extract/`, `docs/STATUS.md`, `docs/SIMULATION.md` |
| **Nooman** | Opus 5.5 (Claude Code) | Chain and app lead. Contract, wallet, all other frontend pages, hosting. | `packages/contracts/`, `packages/frontend/` (everything except the two folders above), `packages/shared/` (auto-generated), Vercel config |
| **Adithi** | ChatGPT / free tools | Wallets, QA, demo operations, demo video, deck (with Dhruva). **Does not edit code.** | `docs/QA.md`, `docs/WALLETS.md` (public addresses only), `pitch/` |
| **Dhruva** | ChatGPT / free tools | Exam content, leak evidence photos, README draft, pitch narrative, Instagram reel. **Does not edit code.** | `demo-data/master-paper.json`, `demo-data/leaks/`, `docs/README-draft.md`, `pitch/` |

**Working rules:**
- Sampurna and Nooman work on branches `sampurna/<topic>` and `nooman/<topic>`. Sampurna merges to `main` at gates after `pnpm test` and `pnpm build` pass.
- Adithi and Dhruva upload files through the GitHub web UI **only into their own folders**. Sampurna validates the master paper with `pnpm ops validate-paper`.
- **Never have both Opus holders asleep at the same time.**

---

## 4. Timeline (H0 = kickoff)

Write the real clock time for each H-mark in `docs/STATUS.md` at kickoff. If fewer than 24 hours remain, shrink **Phase 4** first, then use the cut list.

### Phase 0: Setup and proofs of life (H0–H1)

| Who | Tasks |
|---|---|
| Nooman | Scaffold with VibeKit (`--template blank`). Create a **public** GitHub repo and add the team. Deploy the scaffold's `Hello` contract to testnet and verify it. This proves the toolchain end to end. |
| Sampurna | Create the `packages/core` skeleton with vitest. Create `docs/STATUS.md` and `docs/DECISIONS.md`. Confirm an Anthropic **API** key is available (§10). Run one vision-model call on any photo of printed text. |
| Adithi | Install BridgeKey in 4 Chrome profiles (Authority, Custodian 1, 2, 3). Claim faucet funds for all 4 plus 2 scripted custodian wallets. Record **public addresses only** in `docs/WALLETS.md`. With Nooman, check that BridgeKey connects to the scaffold on localhost and can sign `Hello.setMessage`. |
| Dhruva | Draft the 12-question master paper with ChatGPT using the brief in §17, following every rule in §9. Upload to `demo-data/master-paper.json` by H2. |

**Gate G0 (H1):** a real testnet transaction from our repo, and BridgeKey signing on localhost.

### Phase 1: Core building (H1–H5)

| Who | Tasks |
|---|---|
| Nooman | Implement `ExamSealRegistry.sol` exactly per §6, with every contract test in §13. Deploy to testnet and verify. Then test the explicit-gas early-release trick on testnet (§2). |
| Sampurna | Build `examseal-core`: aes, shamir, seal, recover, commit, canonical, paper, codebook, variant (§7–§9), all with tests. Once G1 lands, add the cross-check test proving TypeScript commitments equal Solidity's. Add `ops render` so Dhruva can print a variant. |
| Adithi | Turn §13 into a step-by-step checklist in `docs/QA.md`. Start an 8-slide deck skeleton in `pitch/` (§17 brief). Write a judge Q&A sheet from §15. |
| Dhruva | Fix the master paper based on `validate-paper` output. Draw the architecture diagram from §5 (Excalidraw or draw.io). Write the problem and how-it-works sections in `docs/README-draft.md`. |

**Gate G1 (H4):** contract deployed and verified on testnet; all contract tests green.
**Gate G2 (H4–H5):** core round trip works (encrypt → split → seal → open any 3 → decrypt); 2 pieces fail; TypeScript commitments equal Solidity commitments.

### Phase 2: Integration (H5–H10)

| Who | Tasks |
|---|---|
| Sampurna | `ops seed` creates a real demo exam on testnet by **H6** (§12). Build `/api/extract`, the forensic matcher, and the `/trace` page (§10). Write `ops simulate`. |
| Nooman | Build `/`, `/exam/[id]` (timeline and authority actions), `/custodian`, and `/centre` (§11). **Make the first Vercel deploy by H8** to catch build problems early. |
| Dhruva | At H5–H6, print Centre 14's variant (`ops render --centre 14`) and take the leak photos listed in §12. Upload to `demo-data/leaks/`. Then continue the README draft and film reel footage. |
| Adithi | QA every page as it merges. File GitHub Issues with steps to reproduce. Rehearse the 3-custodian release across 3 laptops or profiles. |

**Gate G3 (H10): MVP end to end on testnet.** Seed → rejected early release (visible on MSTScan) → 3 BridgeKey releases → centre decrypts → trace a real photo to Centre 14 → record evidence → revoke. **If G3 slips past H12, apply the cut list now.**

### Phase 3: Hardening (H10–H14)

| Who | Tasks |
|---|---|
| Sampurna | Run the simulation and write `docs/SIMULATION.md`. Tune matcher thresholds **only from simulation results**. Test every real leak photo. Polish the evidence report. |
| Nooman | Polish the UI into the "control room" style (§11). Check on a phone and on a projector resolution. Check every explorer link. Finalise Vercel environment variables. |
| Adithi | Run the full attack checklist (§13) **on the hosted site** and record pass/fail in `docs/QA.md`. |
| Dhruva | Sleep H11–H12:30. Then put **real numbers** from `docs/SIMULATION.md` into the deck. |

**Gate G4 (H14):** public link works on a phone, attack checklist passes. **Feature freeze.**

### Phase 4: Stretch goals, only if G4 is green (H14–H18)

Priority order: (1) public `/verify` page using on-chain revealed fingerprints; (2) backup paper set (§6 note); (3) authority "create exam" wizard in the UI (the seed script remains the reliable path).
Adithi and Dhruva finalise the deck and rehearse the run-book (§12) at least 3 times.

### Phase 5: Record and document (H18–H21)

| Who | Tasks |
|---|---|
| Adithi | Record the **demo video** (3–4 minutes, screen plus voice, following the run-book). Upload as unlisted YouTube or public Drive. |
| Dhruva | Finalise the README with Sampurna (§14 checklist). Post the Instagram reel (§14). |
| Sampurna, Nooman | Bug fixes only. **Code freeze at H20.** Tag `v1.0`. |

**Gate G5 (H20):** video recorded, README complete, code frozen.

### Phase 6: Submit and rehearse (H21–H24)

- **Submit the form by H22** (2-hour buffer). Fields: GitHub repo, testnet contract address, transaction hash, demo link, demo video.
- Rehearse the run-book 5 times. **Seed a fresh exam before each judge visit.**

**Gate G6 (H22):** form submitted, reel posted.

### Cut list (apply in this order when behind)

1. Backup paper set
2. Public `/verify` page
3. Authority create-exam wizard (keep the seed script)
4. 20 centres → 8 centres
5. Extra simulation settings (keep k = 3, 4, 6, 12)

**Never cut:** rejected early release, 3-of-5 BridgeKey release, centre decryption, trace from a real photo, record evidence + revoke, real explorer links, README, demo video.

### Sleep rotation (90-minute naps)

| Window | Asleep |
|---|---|
| H11–H12:30 | Dhruva |
| H12:30–H14 | Adithi |
| H15–H16:30 | Nooman |
| H16:30–H18 | Sampurna |

---

## 5. Architecture

```
                     ┌────────────────────────── MST TESTNET ──────────────────────────┐
                     │  ExamSealRegistry                                                │
                     │   createExam · registerCentres (encrypted copies as events)      │
                     │   releaseShares (time-locked) · recordLeak · revokeCentre        │
                     │   revealFingerprint (commit → reveal)                            │
                     └──────▲──────────────▲───────────────▲──────────────▲─────────────┘
                            │              │               │              │
          ops scripts (tsx) │   BridgeKey  │   read via    │   BridgeKey  │
          authority wallet  │   custodians │   /api/rpc    │   authority  │
                            │              │               │              │
 ┌──────────────────────────┴───┐  ┌───────┴────────┐  ┌───┴──────────┐  ┌┴────────────────────┐
 │ ops seed (Sampurna)          │  │ /custodian     │  │ /centre      │  │ /trace + /exam/[id] │
 │ master paper → codebook      │  │ load custodian │  │ load centre  │  │ photo → /api/extract│
 │ → 20 variants → AES encrypt  │  │ file → release │  │ key → open 3 │  │ (vision = text only)│
 │ → Shamir 3-of-5 → seal each  │  │ pieces (1 tx)  │  │ pieces →     │  │ → matcher (in       │
 │ piece to its centre          │  │                │  │ decrypt →    │  │ browser, codebook)  │
 │ → commitments → txs          │  │                │  │ print        │  │ → evidence → tx     │
 │ → secret files (gitignored)  │  │                │  │              │  │ → revoke → tx       │
 └──────────────────────────────┘  └────────────────┘  └──────────────┘  └─────────────────────┘
```

**Where each secret lives:**

| Secret | Location | Seen by |
|---|---|---|
| AES key per centre | Memory only during seeding, then discarded | Nobody afterwards |
| Custodian's sealed pieces | `custodian-*.custodian.secret.json` | That custodian (they can't read the contents; pieces are sealed to the centre) |
| Centre private key | `centre-*.centrekey.secret.json` | That centre only |
| Codebook + fingerprint salts | `codebook.secret.json`, `reveal.secret.json` | Authority only, until reveal time |
| Anthropic API key | Vercel env (server only) | Server route `/api/extract` |

**What goes on-chain:** commitments, encrypted copies (ciphertext only), sealed key pieces (only at or after release time), approval counts, leak evidence hashes, revocations, fingerprints after reveal time.
**What never goes on-chain:** plaintext paper, AES keys, raw Shamir pieces, centre private keys, OCR text, student data.

**Repo layout:**

```
examseal/
├── CLAUDE.md
├── .env.example                  # committed, no values
├── .env.local                    # gitignored
├── packages/
│   ├── contracts/                # Nooman: Hardhat, ExamSealRegistry.sol, tests, deploy.config.ts
│   ├── shared/                   # auto-generated deployments + constants (do not hand-edit contracts.ts)
│   ├── core/                     # Sampurna: "examseal-core" (pure TS, browser + Node)
│   │   ├── src/{hex,canonical,aes,shamir,seal,recover,commit,paper,codebook,variant}.ts
│   │   ├── src/forensic/{normalize,identify,score,decide,evidence,constants}.ts
│   │   └── test/
│   ├── ops/                      # Sampurna: "examseal-ops" (tsx + viem scripts)
│   │   └── src/{seed,release,reveal,render,simulate,validate-paper}.ts
│   └── frontend/                 # Nooman (Sampurna owns app/trace and app/api/extract)
├── demo-data/
│   ├── master-paper.json         # Dhruva
│   ├── leaks/                    # Dhruva: leak photos
│   └── secrets/                  # GITIGNORED: seed outputs
├── docs/                         # STATUS, DECISIONS, QA, WALLETS, SIMULATION, DEMO_RUNS, README-draft
└── pitch/                        # Adithi + Dhruva
```

Add `examseal-core` to `transpilePackages` in `packages/frontend/next.config.js` alongside `examseal-shared`.
Add to `.gitignore`: `demo-data/secrets/`, `*.secret.json`, `.env.local`.

---

## 6. Smart contract spec (FROZEN INTERFACE, owner: Nooman)

File: `packages/contracts/contracts/ExamSealRegistry.sol`. One contract. No upgradeability, no token, no payable functions, no global admin.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IExamSealRegistry {
    enum CentreStatus { None, Sealed, Released, Compromised }

    struct ExamView {
        address authority;
        string title;
        bytes32 paperCommitment;
        uint64 releaseTime;      // chain time; releases revert before this
        uint64 revealTime;       // fingerprints can be revealed from this time
        uint8 threshold;         // e.g. 3
        uint32 centreCount;
        uint64 createdBlock;
        address[] custodians;    // order = Shamir piece index (custodian i holds piece i)
    }

    struct CentreView {
        CentreStatus status;
        uint8 approvals;
        bytes32 encPubKey;              // centre X25519 public key
        bytes32 variantCommitment;      // keccak256(ciphertext), computed ON-CHAIN
        bytes32 fingerprintCommitment;  // keccak256(abi.encode(examId, centreId, fingerprint, salt))
        uint64 registeredBlock;         // block holding EncryptedVariantPublished
        bool fingerprintRevealed;
        bytes32 lastEvidenceHash;
    }

    event ExamCreated(uint256 indexed examId, address indexed authority, string title,
        bytes32 paperCommitment, uint64 releaseTime, uint64 revealTime, uint8 threshold, address[] custodians);
    event CentreRegistered(uint256 indexed examId, uint32 indexed centreId,
        bytes32 encPubKey, bytes32 variantCommitment, bytes32 fingerprintCommitment);
    event EncryptedVariantPublished(uint256 indexed examId, uint32 indexed centreId, bytes ciphertext);
    event ShareReleased(uint256 indexed examId, uint32 indexed centreId, address indexed custodian,
        bytes sealedShare, uint8 approvals);
    event ShareSkipped(uint256 indexed examId, uint32 indexed centreId, address indexed custodian, uint8 reason);
        // reason: 1 = compromised, 2 = duplicate, 3 = unknown centre, 4 = bad length
    event ReleaseAuthorized(uint256 indexed examId, uint32 indexed centreId, uint64 timestamp);
    event LeakRecorded(uint256 indexed examId, uint32 indexed centreId, bytes32 evidenceHash,
        uint16 matched, uint16 observed);
    event CentreRevoked(uint256 indexed examId, uint32 indexed centreId, bytes32 reasonHash);
    event FingerprintRevealed(uint256 indexed examId, uint32 indexed centreId, bytes fingerprint);

    error NotAuthority();
    error NotCustodian();
    error ExamNotFound();
    error CentreNotFound();
    error ReleaseNotStarted(uint64 releaseTime, uint64 nowTs);
    error RegistrationClosed();
    error RevealNotStarted(uint64 revealTime, uint64 nowTs);
    error BadThreshold();
    error BadTimes();
    error BadCustodians();
    error CentreExists();
    error BadPubKey();
    error LengthMismatch();
    error CommitmentMismatch();
    error AlreadyRevealed();

    function createExam(string calldata title, bytes32 paperCommitment, uint64 releaseTime,
        uint64 revealTime, address[] calldata custodians, uint8 threshold) external returns (uint256 examId);

    function registerCentres(uint256 examId, uint32[] calldata centreIds, bytes32[] calldata encPubKeys,
        bytes32[] calldata fingerprintCommitments, bytes[] calldata variantCiphertexts) external;

    function releaseShares(uint256 examId, uint32[] calldata centreIds, bytes[] calldata sealedShares) external;

    function recordLeak(uint256 examId, uint32 centreId, bytes32 evidenceHash, uint16 matched, uint16 observed) external;

    function revokeCentre(uint256 examId, uint32 centreId, bytes32 reasonHash) external;

    function revealFingerprint(uint256 examId, uint32 centreId, bytes calldata fingerprint, bytes32 salt) external;

    function getExam(uint256 examId) external view returns (ExamView memory);
    function getCentre(uint256 examId, uint32 centreId) external view returns (CentreView memory);
    function getCentreIds(uint256 examId) external view returns (uint32[] memory);
    function getShares(uint256 examId, uint32 centreId)
        external view returns (address[] memory custodians, bytes[] memory sealedShares);
    function hasReleased(uint256 examId, uint32 centreId, address custodian) external view returns (bool);
    function nextExamId() external view returns (uint256);
}
```

### Behaviour rules

- **createExam:** `msg.sender` becomes authority. `examId` starts at 1 and increments. Require `2 <= threshold <= custodians.length <= 10`, custodians unique and non-zero (`BadCustodians`), `releaseTime > block.timestamp` and `revealTime >= releaseTime` (`BadTimes`). Store `createdBlock = block.number`.
- **registerCentres:** only the authority. Only while `block.timestamp < releaseTime`, otherwise `RegistrationClosed`. All arrays must be the same length (`LengthMismatch`). Each centre must be new (`CentreExists`) with a non-zero key (`BadPubKey`). **Compute `variantCommitment = keccak256(ciphertext)` inside the contract.** Set status to `Sealed` and `registeredBlock = block.number`. Emit `CentreRegistered` and `EncryptedVariantPublished`. Store the ciphertext in the event only, not in storage.
- **releaseShares (the most important function):**
  - Only a custodian of this exam (`NotCustodian`).
  - If `block.timestamp < releaseTime`, **revert the whole transaction** with `ReleaseNotStarted(releaseTime, block.timestamp)`. This is demo moment 1.
  - Per entry, never revert; instead emit `ShareSkipped`: unknown centre (3), compromised centre (1), already released by this custodian (2), or share length outside 48–256 bytes (4).
  - Otherwise store the sealed share **in storage** (so centres read it with a view call, no log queries), increment approvals, and emit `ShareReleased`. When approvals first reaches the threshold, set status `Released` and emit `ReleaseAuthorized`. Shares beyond the threshold are still accepted (a spare piece makes recovery more robust).
- **recordLeak:** only the authority, at any time. Store `lastEvidenceHash` and emit.
- **revokeCentre:** only the authority, at any time. Set status `Compromised` and emit. **Idempotent:** calling it again succeeds and re-emits; never revert during the live demo.
- **revealFingerprint:** anyone may call, but only after `revealTime` (`RevealNotStarted`), and only once per centre (`AlreadyRevealed`). Require `keccak256(abi.encode(examId, centreId, fingerprint, salt)) == fingerprintCommitment` (`CommitmentMismatch`). Set the revealed flag and emit the fingerprint.
- No external calls, no ETH handling, so no reentrancy surface. Use custom errors everywhere (they decode nicely in viem and Blockscout).

> **Backup set (stretch, not in the frozen interface):** every centre shares the same questions, so one leak exposes the paper everywhere. The real response is switching all centres to a pre-sealed backup set. If time allows, add `activateBackupSet(examId)` plus a second set of centre registrations in a **separate** contract version. Never modify the frozen functions to do this.

---

## 7. Crypto and data formats (FROZEN, owner: Sampurna)

**Libraries (pin exact versions):**
- `shamir-secret-sharing@0.0.4` (Privy, audited). `split(secret, shares, threshold)` and `combine(shares)`. A 32-byte secret gives 33-byte shares.
- `@noble/curves@1.9.7`: `import { x25519 } from "@noble/curves/ed25519"`
- `@noble/hashes@1.8.0`: `import { hkdf } from "@noble/hashes/hkdf"`, `import { sha256 } from "@noble/hashes/sha2"`
- WebCrypto `globalThis.crypto.subtle` for AES-256-GCM (available in browsers and Node ≥ 18).
- viem for `keccak256`, `encodeAbiParameters`, and hex helpers.

Pinning 1.x versions of noble keeps both CommonJS and ESM builds available. Do not upgrade to 2.x during the hackathon.

**Encoding:** all binary in JSON files is `0x`-prefixed lowercase hex.

**AES variant blob:** `nonce(12) || ciphertext || tag(16)`. AES-256-GCM, random 12-byte nonce, AAD = UTF-8 of `examseal/v1/variant/{examId}/{centreId}`. **Seeding order:** send `createExam` first to get `examId`, then encrypt with that AAD.

**Shamir:** `split(aesKey32, 5, 3)` gives 5 pieces of 33 bytes. Piece `i` belongs to `exam.custodians[i]`.

**Sealed piece (ECIES over X25519), 93 bytes total:**
```
ephSk      = random 32 bytes
ephPk      = x25519.getPublicKey(ephSk)                                  // 32 bytes
shared     = x25519.getSharedSecret(ephSk, centrePk)
k          = hkdf(sha256, shared, salt = ephPk || centrePk, info = utf8("examseal/v1/share"), 32)
nonce      = random 12 bytes
ct||tag    = AES-256-GCM(k, nonce, piece33, aad = utf8(`examseal/v1/share/${examId}/${centreId}`))  // 33 + 16
blob       = ephPk(32) || nonce(12) || ct||tag(49)                         // 93 bytes
```
`encPubKey` on-chain = the centre's 32-byte X25519 public key as `bytes32`.

**Canonical JSON:** keys sorted recursively, no whitespace, strings NFC-normalised, integers only (no floats). A single `canonicalJson()` in core is used everywhere.

**Commitments:**
- `paperCommitment = keccak256(concat(utf8(canonicalJson(master)), paperSalt32))`
- `variantCommitment = keccak256(aesBlob)`, computed on-chain; the centre page recomputes it and **refuses to decrypt on mismatch**.
- `fingerprintCommitment = keccak256(encodeAbiParameters([uint256, uint32, bytes, bytes32], [examId, centreId, fingerprint, salt]))`. **Must equal Solidity's `keccak256(abi.encode(...))`: a cross-check test is required for G2.**
- `evidenceHash = keccak256(utf8(canonicalJson(evidenceReport)))`
- `reasonHash = keccak256(utf8(reasonText))`

**Fingerprint bytes** (37 bytes for 12 questions):
```
byte 0            = 0x01 (version)
then for each question in MASTER order (Q01..Q12), 3 bytes:
  position        = 1-based printed position in this centre's paper (1..12)
  optionPermIndex = Lehmer index of the option permutation (0..23)
  wordingIndex    = 0 or 1
```
`optionPerm[j]` = the master option index printed at label j (A = 0 … D = 3).

**Secret files** written by `ops seed` to `demo-data/secrets/exam-<id>/` (all gitignored):

| File | Contents |
|---|---|
| `centres/centre-14.centrekey.secret.json` | `{ version, examId, contract, centreId, x25519PublicKey, x25519PrivateKey }` |
| `custodians/custodian-1-0xabc….custodian.secret.json` | `{ version, examId, contract, custodianIndex, custodianAddress, shares: [{ centreId, sealedShare }] }` |
| `codebook.secret.json` | `{ version, codebookSeed, centres: [{ centreId, order: [qid…], optionPerms: { qid: [4 ints] }, wordings: { qid: 0 or 1 } }] }` |
| `reveal.secret.json` | `{ examId, centres: [{ centreId, fingerprint, salt }] }` |
| `variants/centre-14.variant.secret.json` and `centre-14.html` | Plaintext variant and a printable page (for making leak photos) |
| `summary.json` (not secret) | examId, contract, all tx hashes, release and reveal times |

---

## 8. Core package API (FROZEN, owner: Sampurna)

`packages/core` is published in the workspace as `examseal-core` (`"main": "src/index.ts"`, like `examseal-shared`). Pure TypeScript, runs in browser and Node, **no Node-only APIs** (no `fs`, no `Buffer`).

```ts
export type Hex = `0x${string}`;

// aes.ts
export function generateAesKey(): Uint8Array;                                        // 32 bytes
export function aesGcmEncrypt(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
export function aesGcmDecrypt(key: Uint8Array, blob: Uint8Array, aad: Uint8Array): Promise<Uint8Array>; // throws on auth failure

// shamir.ts
export function splitKey(key: Uint8Array, n?: number, t?: number): Promise<Uint8Array[]>; // defaults 5, 3
export function combinePieces(pieces: Uint8Array[]): Promise<Uint8Array>;

// seal.ts
export function generateCentreKeypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
export function sealPiece(piece: Uint8Array, centrePk: Uint8Array, examId: bigint, centreId: number): Promise<Uint8Array>;
export function openPiece(blob: Uint8Array, centreSk: Uint8Array, centrePk: Uint8Array, examId: bigint, centreId: number): Promise<Uint8Array>;

// recover.ts: tries every combination of `threshold` pieces until AES-GCM succeeds (C(5,3) = 10 max)
export function recoverVariant(args: {
  sealedPieces: Uint8Array[]; centreSk: Uint8Array; centrePk: Uint8Array;
  ciphertext: Uint8Array; examId: bigint; centreId: number; threshold: number;
}): Promise<{ plaintext: Uint8Array; usedPieceIndices: number[]; badPieceIndices: number[] }>;

// commit.ts
export function paperCommitment(master: MasterPaper, salt: Uint8Array): Hex;
export function variantCommitment(blob: Uint8Array): Hex;
export function fingerprintCommitment(examId: bigint, centreId: number, fingerprint: Uint8Array, salt: Uint8Array): Hex;
export function evidenceHash(report: EvidenceReport): Hex;

// canonical.ts / hex.ts
export function canonicalJson(value: unknown): string;
export function toHexBytes(b: Uint8Array): Hex;
export function fromHexBytes(h: Hex): Uint8Array;

// paper.ts
export type MasterQuestion = { id: string; wordings: [string, string]; options: [string, string, string, string]; answerIndex: 0 | 1 | 2 | 3 };
export type MasterPaper = { version: 1; title: string; subject: string; durationMinutes: number; instructions: string; questions: MasterQuestion[] };
export function validateMasterPaper(p: unknown): { ok: true; paper: MasterPaper } | { ok: false; errors: string[] };

// codebook.ts
export type CentreCode = { centreId: number; order: string[]; optionPerms: Record<string, number[]>; wordings: Record<string, 0 | 1> };
export function generateCodebook(master: MasterPaper, centreIds: number[], seed: Uint8Array): CentreCode[]; // enforces §9 distances
export function encodeFingerprint(master: MasterPaper, code: CentreCode): Uint8Array;               // §7 layout
export function decodeFingerprint(master: MasterPaper, centreId: number, bytes: Uint8Array): CentreCode;
export function lehmerIndex(perm: number[]): number;
export function permFromLehmer(index: number, n: number): number[];

// variant.ts
export type VariantPaper = {
  version: 1; examTitle: string; subject: string; durationMinutes: number; instructions: string;
  questions: { number: number; text: string; options: { label: "A" | "B" | "C" | "D"; text: string }[] }[];
};  // NO centre id, NO question ids, NO answers: exactly what gets printed
export function buildVariant(master: MasterPaper, code: CentreCode): VariantPaper;
export function renderVariantHtml(v: VariantPaper): string;  // printable, identical layout for every centre

// forensic/*
export type Extraction = { questions: { printedNumber: number | null; text: string; options: { label: string | null; text: string }[] }[]; legibility: "good" | "partial" | "poor" };
export type Observation = { qid: string; position: number | null; optionPerm: number[] | null; wordingIndex: 0 | 1 | null };
export type CentreScore = { centreId: number; matched: number; observed: number; perQuestion: Record<string, { position?: boolean; options?: boolean; wording?: boolean }> };
export type Decision = { kind: "MATCH" | "INCONCLUSIVE" | "NOT_THIS_EXAM"; centreId?: number; best?: CentreScore; runnerUp?: CentreScore; reason: string };
export function identifyQuestions(x: Extraction, master: MasterPaper): Observation[];
export function scoreCentres(obs: Observation[], codebook: CentreCode[]): CentreScore[];   // sorted desc
export function decide(scores: CentreScore[], identifiedCount: number): Decision;
export type EvidenceReport = { version: 1; examId: string; imageSha256: Hex; extraction: Extraction; observations: Observation[]; scores: CentreScore[]; decision: Decision; matcherVersion: string; createdAt: string };
export function buildEvidenceReport(args: Omit<EvidenceReport, "version" | "matcherVersion">): EvidenceReport;
```

---

## 9. Paper, variants, and codebook

### Master paper (`demo-data/master-paper.json`, authored by Dhruva)

```json
{
  "version": 1,
  "title": "SNPSU B.Tech Semester Examination (Demo)",
  "subject": "Computer Science Fundamentals",
  "durationMinutes": 30,
  "instructions": "Answer all questions. Each question carries one mark.",
  "questions": [
    {
      "id": "Q01",
      "wordings": [
        "Which data structure follows the First-In-First-Out principle?",
        "Which data structure processes its elements in First-In-First-Out order?"
      ],
      "options": ["Stack", "Queue", "Binary tree", "Hash table"],
      "answerIndex": 1
    }
  ]
}
```

**Authoring rules (enforced by `ops validate-paper` where mechanical):**
1. Exactly 12 questions, ids `Q01`–`Q12`.
2. Two wordings per question with **the same meaning and the same answer**, differing by at least 3 words. Written by humans, **never generated live by an LLM**.
3. Exactly 4 options, each at most 8 words, all different.
4. **No "All of the above", "None of the above", "Both A and B"**, or any option that refers to another option's position. Options are shuffled per centre, so these would break.
5. No question refers to another question's number. Plain text only (no images, tables, or LaTeX).
6. Questions must be clearly different from each other (the matcher identifies questions by text similarity).

### Variant generation
- Per centre: its own question order, its own option order for each question, and its own wording choice for each question.
- **Layout is identical for every centre** (same header, font, spacing). Layout is not a fingerprint feature.
- The printed paper shows **no centre number and no hidden marks**.

### Codebook constraints (default 20 centres)
- Deterministic from a 32-byte seed. Use a counter-mode SHA-256 stream as the PRNG, never `Math.random`.
- Accept a codebook only if **every pair** of centres differs in position for ≥ 9 of 12 questions, in option order for ≥ 9 of 12, and in wording for ≥ 4 of 12. Retry up to 10,000 times, then throw.
- **Demo requirement:** `ops seed` uses a fixed `DEMO_CODEBOOK_SEED` from `.env.local`. The same codebook is reused for every demo exam, so the Centre 14 leak photos printed once still match every freshly seeded exam. AES keys, centre keys, and salts are fresh on every run. **State this openly in the README:** in production, every exam gets its own secret codebook.

---

## 10. Forensics: tracing a leaked photo (owner: Sampurna)

**Pipeline:**
1. **Browser:** downscale to a longest side of 1600 px, re-encode as JPEG quality 0.85 through a canvas (this also strips EXIF). Reject files over 3 MB after compression. Compute `imageSha256` of the compressed bytes.
2. **`POST /api/extract`** with `{ imageBase64, mediaType }`. Route settings: `export const runtime = "nodejs"; export const maxDuration = 60;`. Vercel's request-body limit is about 4.5 MB, which is why step 1 compresses.
3. The provider returns an `Extraction`. **Validate it with zod.** Invalid output means one retry, then a clear error.
4. **Matching runs in the browser**, using either the authority's `codebook.secret.json` (loaded with a file picker and kept in memory only) or, after reveal time, the fingerprints revealed on-chain. The codebook never goes to the server.
5. Build the evidence report, then "Record evidence on MST" (`recordLeak`, authority wallet), then "Revoke Centre N".

**Providers** (`EXTRACTOR_PROVIDER` env):
- `claude` (default): model `claude-sonnet-5`, temperature 0, `max_tokens` 4000, via `@anthropic-ai/sdk`. **A Claude.ai subscription does not include API access.** This needs an API key with credits from the Anthropic Console, stored as `ANTHROPIC_API_KEY` in Vercel. Confirm in H0.
- `gemini`: fallback if there's no Anthropic API key. Check the current free-tier vision model name before using it.
- `manual`: paste a transcription instead of a photo. The UI **must** show a "Manual transcription" badge, and this mode is **never** presented as AI in the demo.

**Extraction prompt (system):**
```
You transcribe printed exam question papers from photos. Output ONLY a JSON object, no prose, no code fences:
{"questions":[{"printedNumber":<int or null>,"text":"<question text>","options":[{"label":"A"|"B"|"C"|"D"|null,"text":"<option text>"}]}],"legibility":"good"|"partial"|"poor"}
Rules:
- Transcribe exactly as printed. Do not correct spelling, paraphrase, translate, or complete cut-off text.
- Keep questions and options in the order they appear on the page.
- If a question or option is unreadable or cut off, omit it rather than guessing.
- printedNumber is the number printed before the question, or null if not visible.
- Ignore headers, instructions, watermarks, and handwriting.
```

**identifyQuestions (deterministic):**
- Normalise: NFKC, lowercase, strip punctuation, collapse whitespace.
- Similarity = max(token Jaccard, character-trigram Dice).
- For each extracted question, find the best (qid, wording) among the 24 candidates. Accept it only if the similarity is ≥ 0.55 **and** it beats the best candidate from any other qid by ≥ 0.10.
- `wordingIndex` is set only if |sim(A) − sim(B)| ≥ 0.08; otherwise null.
- Options: map each extracted option to a master option with similarity ≥ 0.6, one-to-one. If at least 3 map to distinct indices, infer the 4th by elimination and set `optionPerm`; otherwise null.
- `position` = `printedNumber` if it is 1–12; otherwise null.

**scoreCentres:** for each centre, `observed` = number of non-null features, and `matched` = number of those features equal to that centre's code. Keep per-question detail so the UI can show ✓/✗.

**decide** (all constants in `forensic/constants.ts`, each with a comment saying which simulation result justified it):
- 0 questions identified → `NOT_THIS_EXAM`.
- `observed < 4` → `INCONCLUSIVE` ("not enough visible features").
- `best.matched / observed ≥ 0.85` **and** `best.matched − runnerUp.matched ≥ max(3, ceil(0.3 × observed))` → `MATCH`.
- Anything else → `INCONCLUSIVE`.

**UI wording:** "Centre 14: 31 of 33 observed features match. Next closest: Centre 06 with 9." Then a per-question table of ✓/✗ for position, options, and wording. **Never display a percentage "confidence".**

**Simulation (`ops simulate` → `docs/SIMULATION.md`):**
- For k ∈ {2, 3, 4, 6, 8, 12} visible questions, run 1,000 trials: pick a random centre and k random questions from its variant, build a synthetic extraction, then add noise (5% character typos, each option dropped with 20% probability, printed number missing with 30% probability). Record MATCH-correct / INCONCLUSIVE / MATCH-wrong rates.
- Also run 1,000 fake leaks (papers from a codebook that is not in the exam). Record the false-match rate.
- **Target: MATCH-wrong = 0 and fake false-match = 0.** If not, tighten thresholds and rerun. The pitch quotes **only** numbers from this file.

---

## 11. Frontend (owner: Nooman, except `/trace` and `/api/extract` owned by Sampurna)

**Routes:**
- `/` **Control room.** Current exam (from `?exam=` or the latest `nextExamId() - 1`), a phase strip (Sealed → Awaiting release → Released → Compromised), a countdown to release in **chain time**, and a grid of centre tiles (status plus approvals x/5).
- `/exam/[id]` **Exam detail.** Commitments, custodians, and the **chain-of-custody timeline**: every event with its time, block, and MSTScan tx link. Authority actions ("Revoke centre", "Reveal fingerprints", once `revealTime` has passed) are enabled only when the connected wallet is `exam.authority`.
- `/custodian` Load the custodian file → connect BridgeKey → warn if the wallet doesn't match the file → **"Release my pieces for all centres"** (one tx) and **"Attempt early release (demo)"** (shown only before `releaseTime`; explicit gas, §2) → pending → confirmed (block number) → explorer link.
- `/centre` Load the centre key file → shows approvals x/5 → **"Unlock paper"** (disabled below the threshold) → fetch ciphertext (single-block log query at `registeredBlock`) → check `variantCommitment` ✓ → `recoverVariant` → printable paper. If one piece is bad, show "1 invalid piece ignored". If the centre is compromised, show a red **DO NOT USE** banner.
- `/trace` (Sampurna) Upload photo → preview of the extraction → load codebook *or* use on-chain revealed fingerprints → result card → **"Record evidence on MST"** → **"Revoke Centre N"**.
- `/verify` (stretch) Public: choose exam and centre, show commitments and the revealed fingerprint, and re-run the matcher on an uploaded evidence report.

**Shared components:** `TxLink`, `StatusPill`, `ChainCountdown`, `CustodyTimeline`, `HashDisplay` (`0x1234…abcd` + copy), `ErrorBanner`, `FileLoader` (secret files read into memory only; **never** saved to localStorage or sent to the server).

**UX rules:**
- Every write shows pending → confirmed (with block number) → explorer link. No optimistic chain state.
- Decode custom errors into plain words. Example: `ReleaseNotStarted` → "Rejected by the contract: release opens at 10:00:00 (chain time). Your transaction was recorded as failed."
- Poll every 3 s (one block). Refreshing the page mid-flow must fully recover state from the chain.

**Style: a government control room, not a crypto app.** Dark slate background, one accent per state (amber = pending, green = released, red = compromised), monospace for hashes, no gradients, no coins, no emoji. Large type readable on a projector. Must work at 1280×720 and on a phone. Spell "centre" consistently.

---

## 12. Ops scripts and demo operations (owner: Sampurna)

`packages/ops` runs with `tsx` and viem, signing with keys from `.env.local`:

| Command | What it does |
|---|---|
| `pnpm ops validate-paper` | Checks `demo-data/master-paper.json` against §9 and prints every error |
| `pnpm ops seed --centres 20 --release-in 150 --reveal-after 120` | Full seed: codebook (from `DEMO_CODEBOOK_SEED`) → `createExam` → variants → AES → Shamir → sealed pieces → fingerprints and commitments → `registerCentres` in chunks of 5 → writes secret files → prints examId, chain-time release time, and tx links → appends to `docs/DEMO_RUNS.md` |
| `pnpm ops release --exam <id> --custodian 4` | Releases for scripted custodians 4 and 5 (to show 4/5 or 5/5) |
| `pnpm ops reveal --exam <id>` | Reveals all fingerprints after reveal time |
| `pnpm ops render --exam <id> --centre 14` | Writes a printable HTML variant (for leak photos) |
| `pnpm ops simulate` | Writes `docs/SIMULATION.md` |

**`.env.local` (root, gitignored; `.env.example` lists names only):**
```
PRIVATE_KEY=                  # Hardhat deployer (same wallet as authority)
AUTHORITY_PRIVATE_KEY=        # ops scripts: createExam, registerCentres, recordLeak, revoke, reveal
CUSTODIAN_ADDRESSES=          # 5 comma-separated addresses: 1–3 = BridgeKey (live), 4–5 = scripted
CUSTODIAN_4_PRIVATE_KEY=
CUSTODIAN_5_PRIVATE_KEY=
DEMO_CODEBOOK_SEED=           # fixed 32-byte hex so printed leak photos match every demo exam
MSTSCAN_API_KEY=placeholder
ANTHROPIC_API_KEY=            # also set in Vercel (server only)
EXTRACTOR_PROVIDER=claude
```
Import the authority key into the BridgeKey **Authority** Chrome profile (BridgeKey supports importing a private key) so UI authority actions and scripts use the same wallet.

**Leak evidence (Dhruva, H5–H6, into `demo-data/leaks/`):** print Centre 14's variant, then capture:
1. A straight, well-lit phone photo
2. An angled photo
3. A low-light photo
4. Only the top half of the page
5. Only the bottom half
6. Photo 1 forwarded through WhatsApp (download the compressed copy)
7. **A fake leak:** the master paper printed in master order (must come out INCONCLUSIVE)

Name files `centre14-01-straight.jpg` and so on. Every photo is tested in Phase 3.

### Judge run-book (about 7 minutes)

**Before each judge visit:** `pnpm ops seed --release-in 150`. Open `/` on the main laptop, and `/custodian` on 3 laptops or profiles with custodian files loaded. Have the leak photo ready on a phone.

1. **Hook (20 s):** show the WhatsApp photo. "It's 7:42 AM. This paper is on WhatsApp. Where did it come from? We'll find out in a few minutes."
2. **Lock, early release (judge clicks):** on a custodian laptop, the judge presses "Attempt early release" → **rejected** → open the failed tx on MSTScan showing `ReleaseNotStarted`.
3. While the countdown runs, explain Lock in 60 seconds using the control room: 20 centres sealed, 5 custodians, threshold 3.
4. **Release:** custodians 1, 2, 3 release → tiles go 1/5 → 2/5 → 3/5 → **RELEASE AUTHORIZED**. Show the tx links.
5. **Centre:** unlock Centre 14's paper → commitment ✓ → the paper appears.
6. **Trace (judge uploads):** the judge uploads the leak photo → **"Centre 14: X of Y features match; next closest Z"** with the ✓/✗ table.
7. **Accountability:** "Record evidence on MST" → tx. **"Revoke Centre 14"** → tx → tile turns red; the centre page shows DO NOT USE. Open the chain-of-custody timeline.
8. **Close** with the pitch line, plus one real number from `docs/SIMULATION.md`.

**Fallbacks:** if the chain is slow, keep talking and never fake it. If the vision API fails, retry once, then switch to the backup photo. If everything fails, play the demo video.

---

## 13. Tests and attack checklist

**Contract tests (Nooman, Hardhat):**
- createExam validation: threshold, times, duplicate or zero custodians.
- registerCentres: only authority; closes at `releaseTime`; commitment computed on-chain equals `keccak256(ciphertext)`; duplicate centre reverts; zero key reverts.
- releaseShares: reverts `ReleaseNotStarted` before the time (check the args); non-custodian reverts; duplicate → skipped(2); compromised → skipped(1); unknown centre → skipped(3); bad length → skipped(4); approvals increment; `ReleaseAuthorized` emitted exactly once at the threshold; a 4th share is accepted.
- revoke is idempotent; recordLeak is authority-only.
- revealFingerprint: before time reverts; wrong salt → `CommitmentMismatch`; second reveal → `AlreadyRevealed`; the emitted fingerprint matches.
- **Cross-check:** a fingerprint commitment computed in TypeScript (fixture) equals the contract's.

**Core tests (Sampurna, vitest):**
- AES round trip; tampered blob fails; wrong AAD fails.
- Any 3 of 5 pieces recover the key; 2 pieces do not.
- Sealed piece: the right centre opens it; the wrong centre key fails; wrong examId or centreId in the AAD fails.
- `recoverVariant` with 1 bad piece among 4 still succeeds and reports the bad index.
- Lehmer encode/decode round trip for all 24 permutations.
- Codebook meets the minimum distances; same seed gives the same codebook.
- `canonicalJson` is stable regardless of key order.
- Forensics: an exact synthetic leak → correct MATCH; 3 visible questions → MATCH or INCONCLUSIVE, **never a wrong MATCH**; master-order fake → INCONCLUSIVE; unrelated text → NOT_THIS_EXAM.

**Manual QA on the hosted site (Adithi, `docs/QA.md`, pass/fail with tx links):**
1. With 1/5 released, the centre can't unlock.
2. With 2/5 released, the centre can't unlock.
3. Early release → rejected; failed tx visible on MSTScan.
4. Wrong centre key file → clear error, no crash.
5. Revoked centre → further releases skipped; the centre page shows DO NOT USE.
6. Each real leak photo (1–6) → Centre 14.
7. Fake leak (7) → INCONCLUSIVE.
8. Refreshing mid-flow → the state recovers from the chain.
9. Phone view is usable; projector view is readable.
10. Every tx link opens the right transaction on testnet.mstscan.com.

---

## 14. Deployment, README, and submission

**Vercel:** Root Directory = `packages/frontend`, with "Include files outside root directory" enabled (monorepo). Set env vars `ANTHROPIC_API_KEY` and `EXTRACTOR_PROVIDER`. **First deploy by H8.** Redeploy after every gate merge.

**Contract:** deployed and **verified** on testnet.mstscan.com, so judges can read the source.

**README must include:**
1. One-line summary and the pitch line
2. The problem (2–3 sentences)
3. How it works: Lock / Trace / Proof, plus the architecture diagram
4. **MST integration details:** each contract function, what it enforces, and why it must be on-chain
5. Testnet contract address and explorer link
6. At least 3 real tx hashes (createExam, releaseShares, recordLeak or revoke), including one rejected early release
7. Demo link and demo video link
8. Setup instructions (pnpm install, env names, seed, run)
9. Simulation results table (copied from `docs/SIMULATION.md`)
10. **Honest limitations** (§15)
11. Team

**Submission form (by H22):** GitHub repo, testnet contract address, tx hash, demo link, demo video. Check every link in an incognito window first.

**Social track (Instagram reel):** at least 30 s, team faces on camera, posted publicly, mention **@mstblockchain** and **@newrro_tech**, clearly say you're building on MST Blockchain, and include it in the submission form.

---

## 15. Claims policy and honest answers (use in UI copy, README, and Q&A)

- **"Why not a normal database?"** The same organisation that might be blamed would control the evidence. On MST, commitments and release events can't be rewritten, not even by the exam board.
- **"What if 3 custodians collude?"** They can open it early. We don't claim leak-proof. Collusion now needs several people, and every release is signed and permanent.
- **"Encrypted copies are on-chain. Isn't that risky?"** They're AES-256 ciphertext. The key never exists anywhere until 3 custodians release their pieces at exam time, and those pieces are sealed so only that centre can open them.
- **"What if someone retypes the paper?"** Question order, option order, and wording usually survive retyping. Someone who deliberately rewrites and reshuffles everything can defeat attribution. We say so.
- **"Does a leak from one centre expose everyone?"** Yes, because all centres share the questions. ExamSeal's job is proving where the leak came from; the operational response is a pre-sealed backup set (roadmap).
- **"Who created the paper?"** The exam authority is trusted when the paper is created. ExamSeal protects everything after sealing.
- **"Is the demo codebook special?"** Yes: the demo reuses one codebook so printed photos match every fresh demo exam. In production, each exam gets a new secret codebook.
- Attribution identifies the **centre**, not a specific person.

---

## 16. Commands

```bash
pnpm install
pnpm compile                        # contracts
pnpm test                           # contracts + core
pnpm deploy:testnet && pnpm verify:testnet
pnpm dev                            # frontend at localhost:3000 (the chain is MST Testnet, not a local node)
pnpm ops validate-paper
pnpm ops seed --centres 20 --release-in 150 --reveal-after 120
pnpm ops release --exam <id> --custodian 4
pnpm ops reveal --exam <id>
pnpm ops render --exam <id> --centre 14
pnpm ops simulate
```
Add a root script `"ops": "pnpm --filter examseal-ops run cli"` so `pnpm ops <cmd>` works.

---

## 17. Kickoff prompts and ChatGPT briefs

### Claude Code: Sampurna (paste at H0)
> Read CLAUDE.md fully. You are working for Sampurna, the integration owner; only edit her folders (§3). Start Phase 0–1: create `packages/core` as `examseal-core` per §8 with the pinned libraries from §7. Write vitest tests first for the core test list in §13, then implement aes, shamir, seal, recover, canonical, hex, and commit until they pass. Then paper, codebook, and variant per §9, plus `packages/ops` with `validate-paper` and `render`. Do not touch contracts or frontend pages. Stop when G2 is satisfied (except the Solidity cross-check, which needs G1) and summarise what passed.

### Claude Code: Nooman (paste at H0)
> Read CLAUDE.md fully. You are working for Nooman; only edit his folders (§3). Scaffold with `npx create-mst-app examseal --template blank --pm pnpm --git --yes`, deploy the Hello contract to MST Testnet, and verify it (G0). Then implement `ExamSealRegistry.sol` exactly per the §6 interface and behaviour rules, write every contract test in §13, replace Hello in `deploy.config.ts`, deploy to testnet, and verify on MSTScan (G1). Then write a small script that sends an early `releaseShares` with explicit gas and confirm the failed tx shows on MSTScan (§2). Stop and summarise with tx hashes.

### ChatGPT brief: Dhruva (master paper)
> Write 12 multiple-choice questions for an Indian B.Tech "Computer Science Fundamentals" exam, output as JSON exactly in this format: [paste the §9 JSON example]. Rules: ids Q01–Q12; for each question write TWO wordings with the same meaning and the same correct answer, differing by at least 3 words; exactly 4 options of at most 8 words each, all different; NO "All of the above", "None of the above", "Both A and B", or options that mention other options; questions must not refer to other question numbers; plain text only; every question clearly about a different topic. Include answerIndex (0–3). Output only the JSON.

Then check every answer yourself before uploading. Wrong answers in front of judges look bad.

### ChatGPT brief: Adithi (deck and video)
> Create an 8-slide pitch outline for "ExamSeal: exam papers that no single person can open early, and that trace any leak back to its source," built on MST Blockchain for a hackathon. Slides: 1) hook (leaked paper on WhatsApp), 2) problem, 3) Lock (3-of-5 custodians, time-locked release on MST), 4) Trace (unique copy per centre, leaked photo → centre), 5) why MST (evidence nobody can rewrite; list the on-chain actions), 6) live demo, 7) results (placeholder for simulation numbers), 8) startup path (universities → recruitment boards → national exams; MST grant path). Max 20 words per slide. Never say "leak-proof". Then write a 3.5-minute demo video script following this run-book: [paste §12 run-book].

**Never paste private keys, API keys, or secret files into ChatGPT or any chat.**
