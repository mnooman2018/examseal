# ExamSeal
  
**Traceable exam-paper distribution for secure examinations.**

ExamSeal is a prototype system designed to help protect examination papers before their scheduled release and trace the source of a leaked paper.

For digital examinations, ExamSeal can also create candidate-specific variants, allowing tracing down to an individual seat.

Instead of distributing one identical exam paper to every centre, ExamSeal can create distinguishable centre-specific versions. If a photograph of a paper is leaked, the system can extract the visible questions and compare them against the generated variants to determine the likely source.

## The Problem

Exam papers often pass through multiple people and examination centres before an exam begins. If a photograph of a paper is leaked, identifying where that copy came from can be difficult.

Traditional access control can help protect a paper before distribution, but once a copy has been photographed and shared, the source may be difficult to establish.

ExamSeal is built around two goals:

1. Protect the exam paper until an authorized release.
2. Make distributed paper variants traceable if a leak occurs.

## How ExamSeal Works

The prototype follows this overall flow:

**Create exam → Encrypt → Split release authority → Generate centre variants → Release → Unlock → Analyse leak → Trace source → Record evidence**

### 1. Exam creation

A master examination is created from a structured question set. The current demo uses a 12-question Computer Science Fundamentals examination.

### 2. Protected release

The system protects the paper before its scheduled release. Release authority is distributed so that a single custodian cannot independently authorize access.

The demo is designed around a **3-of-5 release threshold**.

### 3. Centre-specific papers

The master examination can be rendered into distinguishable variants for different examination centres while preserving the meaning and correct answers of the questions.

The current testnet demo contains **20 centres**.

### 4. Digital candidate-level tracing

ExamSeal also supports JEE-style digital examinations through a separate digital flow.

Instead of assigning only a centre-specific paper, each candidate seat can receive its own distinguishable copy. This allows a leaked digital paper to be traced at a finer level, such as **Centre 14, Seat 7**.

According to the project's simulation tests, centre-level tracing produced no incorrect centre identifications across 6,000 simulated leaks. For seat-level tracing, a half-paper leak identified the exact seat about 4 times in 5 without naming an incorrect seat, while a full-paper leak identified the exact seat in 999 out of 1,000 simulations.

These figures are simulation results and should not be interpreted as real-world deployment accuracy.

### 5. Leak analysis

A suspected leak can be submitted as a photograph.

ExamSeal uses an image-text extraction stage to transcribe the visible examination content. The extracted content is then validated and compared deterministically against known paper variants.

The leak-testing plan includes:

- Straight, well-lit photograph
- Angled photograph
- Low-light photograph
- Top-half crop
- Bottom-half crop
- WhatsApp-compressed photograph
- A fake/non-matching leak

The first six test images are intended to trace back to **Centre 14**. The fake leak is expected to return **INCONCLUSIVE**.

## Blockchain and Verification

ExamSeal uses a testnet registry to provide verifiable records for parts of the examination lifecycle.

The `ExamSealRegistry` contract has been deployed and verified on MST Testnet. The project also tests release authorization, commitments and the core encryption/decryption lifecycle.

## Current Demo

The current demo examination is **Exam 3**, seeded on MST Testnet with **20 centres**.

The project is actively being tested end-to-end. Individual QA results are tracked in `docs/QA.md`, and testnet demo runs are recorded in `docs/DEMO_RUNS.md`.

## Tech Stack

- TypeScript
- Solidity
- viem
- Vercel
- MST Testnet
- Gemini-based image text extraction
- Zod validation
- Shamir secret sharing
- Noble cryptographic libraries

## Repository Guide

- `packages/` — application and core packages
- `demo-data/` — demo examination and leak-test data
- `docs/` — project decisions, QA, status and demo records
- `pitch/` — presentation and pitch material
- `QUICKSTART.md` — local setup instructions

## Project Status

ExamSeal is a hackathon prototype under active development and testing.

See `docs/STATUS.md` for the latest implementation status and `docs/QA.md` for the manual QA checklist.

## Disclaimer

ExamSeal is an academic hackathon prototype. The examination papers and leak scenarios used in the demonstration are synthetic demo materials and are not real confidential examination papers.
