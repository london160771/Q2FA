# Q2FA — PLAN

## Current Status

Phase 0 is complete and passed on Arc Mainnet.

Do not repeat Phase 0 unless a concrete regression requires it.

---

# Phase 1 — Smart Account Core

## Goal

Build the minimum Q2FA smart account contract with the locked two-factor security model.

## Deliverables

- contract project/tooling;
- Q2FA smart account contract;
- owner state;
- guardian public-key state;
- nonce;
- Arc PQ verifier interface;
- deterministic protected-action hashing;
- withdrawal function;
- owner rotation;
- guardian rotation;
- events;
- local contract tests.

## Required Tests

- owner + valid PQ signature succeeds;
- owner without PQ fails;
- non-owner with PQ fails;
- invalid PQ signature fails;
- changed recipient fails;
- changed amount fails;
- replay fails;
- expired authorization fails;
- owner change requires both;
- guardian change requires both;
- zero-address/invalid input cases fail.

## Mainnet Gate

After local tests pass:

1. estimate deployment cost;
2. deploy one Q2FA instance from Wallet A;
3. verify owner and guardian state;
4. execute the smallest practical mainnet protected-action test;
5. record hashes and actual cost.

Use tiny values only.

## Stop Condition

Stop after the contract/security gate passes.

Do not begin dashboard implementation until Phase 1 is reviewed.

---

# Phase 2 — Guardian Client + End-to-End Authorization

## Goal

Implement production-shaped local guardian generation/signing and prove exact frontend/client-to-contract compatibility.

## Deliverables

- deterministic authorization encoder;
- SLH-DSA guardian generation;
- local signing utility;
- payload preview/debug representation;
- nonce/deadline handling;
- signature verification compatibility tests;
- secure client-side key handling;
- guardian export/backup flow only if safely scoped.

## Required Tests

- client payload equals contract payload;
- valid signature accepted;
- one-byte message mutation rejected;
- one-byte signature mutation rejected;
- wrong account rejected;
- wrong chain domain rejected;
- wrong nonce rejected;
- expired deadline rejected.

## Mainnet Gate

Complete one real protected withdrawal from the Q2FA account to Wallet B using both factors.

Record:
- transaction hash;
- amount;
- gas used;
- USDC fee;
- balance changes.

## Stop Condition

Do not proceed until the full two-factor withdrawal works on Arc Mainnet.

---

# Phase 3 — Dashboard

## Goal

Build the user-facing Q2FA product around the proven contract flow.

## Deliverables

### Setup
- connect wallet;
- enforce Arc Mainnet;
- create/deploy account;
- generate guardian;
- register guardian;
- safety warnings.

### Dashboard
- protected USDC balance;
- owner address;
- guardian active state;
- security status;
- nonce;
- recent activity.

### Deposit
- deposit protected USDC;
- balance refresh.

### Send
- recipient;
- amount;
- deadline;
- authorization preview;
- PQ approval;
- EVM submission;
- clear success/failure state.

## UX Gate

A new viewer must understand:

> "Funds need the wallet key and the PQ guardian."

within 15 seconds.

## Stop Condition

No extra V2 features.

---

# Phase 4 — Stolen-Wallet Demo + Security Polish

## Goal

Make the core security claim undeniable.

## Deliverables

- dedicated "Simulate stolen wallet" flow;
- EVM-only protected withdrawal attempt;
- visually clear blocked state;
- legitimate two-factor comparison;
- tampering demo where useful;
- transaction/explorer links;
- polished activity states.

## Demo Sequence

1. show protected balance;
2. attempt withdrawal with owner factor only;
3. show `BLOCKED`;
4. add PQ authorization;
5. submit same intended payment correctly;
6. show successful transfer to Wallet B.

## Security Review

Review:
- authorization bypasses;
- nonce handling;
- domain separation;
- expiry;
- owner/guardian rotation;
- reentrancy;
- secret exposure;
- accidental EOA-balance claims;
- stale signature behavior.

## Stop Condition

All review blockers resolved.

---

# Phase 5 — Final Mainnet Verification + Submission

## Goal

Freeze the MVP and prepare the Arc Microgrant submission.

## Deliverables

- final Arc Mainnet contract;
- final deployed frontend;
- clean public repository;
- updated README;
- architecture diagram;
- concise demo;
- final transaction evidence;
- submission copy;
- `Q2FA_PROJECT_STATE.md` marked complete.

## Final Checks

- no `.env` committed;
- no private keys in git history;
- no disposable Phase 0 PQ secret retained;
- Wallet B only used as intended;
- all tests pass;
- typecheck passes;
- production build passes;
- Arc Mainnet links work;
- dashboard matches actual contract behavior;
- no unimplemented feature claims.

---

# Review Gates

Use a dedicated stronger review after:

1. Phase 1 contract core;
2. Phase 2 first real two-factor withdrawal;
3. Phase 4 security/demo polish;
4. final submission freeze.

---

# Scope Freeze

Until V1 submission, do not add:

- paymaster;
- thresholds;
- social recovery;
- AI;
- cross-chain support;
- multiple guardians;
- backend custody;
- mobile app;
- arbitrary smart-account execution;
- recurring payment features.

Every additional feature must justify delaying the core security demo. Default answer: do not add it.
