# ExamSeal — Pitch Story

## Opening — The Leak

Imagine it is the morning of an important examination.

Before the exam even begins, a photograph of the question paper starts circulating on WhatsApp.

We know the paper has leaked.

But there is a bigger question:

**Where did it come from?**

That is the problem ExamSeal is built to solve.

## The Problem

Exam-paper security has two challenges.

First, how do we keep the paper protected until the authorized release time?

Second, if someone still photographs and leaks a distributed copy, how do we identify its source?

ExamSeal addresses both.

## Lock

Instead of trusting a single person with the release of the paper, ExamSeal distributes that authority among five custodians.

Our demo uses a **3-of-5 threshold**, meaning multiple custodians are required to authorize the release.

Important release events are recorded on MST.

## Trace

Protecting the paper before release is only half the story.

Each examination centre receives a distinguishable variant of the same exam.

If a photograph appears online, ExamSeal extracts the visible examination content and compares it against the known variants.

The goal is to identify the examination centre associated with that leaked copy.

## Centre 14 Demo

For our demonstration, we simulate a leak originating from **Centre 14**.

We test the system using several realistic versions of the same photographed paper:

- A clear straight photograph
- An angled photograph
- A low-light photograph
- A top-half crop
- A bottom-half crop
- A WhatsApp-compressed photograph

We also provide a fake leak that should not match Centre 14.

This allows us to test whether ExamSeal can distinguish a genuine traceable leak from a non-matching paper.

## Live Demo

The demonstration follows the complete story:

**Lock → Release → Unlock → Trace → Record Evidence → Revoke**

Rather than only claiming that the system works, the goal is to demonstrate each stage.

## What ExamSeal Does Not Claim

ExamSeal is not designed to make examination leaks impossible.

If enough trusted custodians collude, or if someone deliberately rewrites and rearranges a paper, attribution can be defeated.

ExamSeal also identifies the **centre associated with a paper variant**, not the individual person responsible for leaking it.

The goal is accountability and traceability.

## Closing

ExamSeal turns a difficult question —

**“The paper leaked. Where did it come from?”**

— into something that can be investigated with verifiable evidence.

Because preventing every leak may not always be possible.

But when a leak happens, knowing where it came from can change what happens next.
