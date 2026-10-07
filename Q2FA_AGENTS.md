# Q2FA — AGENTS

## Purpose

This file defines how coding agents must work on Q2FA.

Q2FA is an Arc Mainnet smart account that protects USDC with two independent authorization factors:

1. a normal EVM owner wallet; and
2. an SLH-DSA-SHA2-128s post-quantum guardian.

For protected actions, both factors must approve the exact same action before the smart account executes it.

---

## Source of Truth

Use this priority order when implementation details conflict:

1. `Q2FA_SPEC.md`
2. `Q2FA_DESIGN.md`
3. `Q2FA_PLAN.md`
4. `Q2FA_PROJECT_STATE.md`
5. `PHASE0_RESULTS.md`
6. existing code and tests
7. comments or assumptions

Do not silently change product scope or architecture.

If implementation reality conflicts with the docs, stop and report the conflict before changing the product model.

---

## Network Rule

Q2FA is **Arc Mainnet-first and Arc Mainnet-only** for real integration testing.

- Chain ID: `5042`
- RPC: `https://rpc.mainnet.arc.io`
- Arc PQ verifier: `0x1800000000000000000000000000000000000004`
- PQ algorithm: `SLH-DSA-SHA2-128s`
- Expected verifying key size: `32 bytes`
- Expected signature size: `7,856 bytes`

Do not introduce Arc testnet unless explicitly instructed.

Local unit tests are allowed and required where useful.

---

## Known Wallet Roles

### Wallet A — owner / deployer
`0x90e3a58694e953f5eC4018fF7dd57BE036f11FcE`

Responsibilities:
- deploy contracts;
- act as initial Q2FA owner;
- submit owner-authorized transactions;
- pay Arc Mainnet gas during development.

### Wallet B — demo recipient
`0x815C2fb8178F0bf80aDa8C5B97fF44Ece90e6e25`

Responsibilities:
- receive successful demo withdrawals;
- remain separate from the owner wallet.

Never require or store either wallet's private key in source control.

---

## Secret Handling

Never:

- print a private key;
- log a private key;
- commit `.env`;
- persist a PQ private key in source control;
- send a PQ private key onchain;
- expose secrets in frontend bundles;
- place secrets in screenshots, reports, test snapshots, or generated artifacts.

The EVM deployer private key must come only from environment configuration.

Production-style PQ guardian private keys must remain client-side.

Phase 0 used an ephemeral PQ key only. Do not reuse it.

---

## Locked V1 Product Rules

The smart account holds protected USDC.

The following actions require **both** the EVM owner factor and the PQ guardian factor:

- withdrawal;
- owner change;
- guardian change.

V1 does not include:

- spending thresholds;
- social recovery;
- paymasters;
- sponsored gas;
- AI;
- backend custody;
- multisig beyond the EVM + PQ two-factor model;
- cross-chain features;
- recurring payments;
- automatic recovery;
- testnet deployment.

Do not add these without explicit approval.

---

## Authorization Rules

Every protected authorization must bind at least:

- `chainId`
- `account`
- `action`
- `recipient` or target subject
- `amount` where applicable
- `nonce`
- `deadline`

The exact encoded payload must be deterministic.

A valid PQ signature for one action must not be reusable for:

- another chain;
- another Q2FA account;
- another recipient;
- another amount;
- another action;
- another nonce;
- an expired request.

---

## Required Security Properties

Implementation must prove:

- EVM-only withdrawal is blocked;
- PQ-only withdrawal is blocked;
- EVM + valid PQ authorization succeeds;
- changing recipient invalidates the PQ authorization;
- changing amount invalidates the PQ authorization;
- replaying an already-consumed authorization fails;
- expired authorization fails;
- unauthorized owner changes fail;
- unauthorized guardian changes fail;
- successful owner/guardian rotation invalidates stale authorizations when applicable.

Do not consider a phase complete while any required security test is missing.

---

## Coding Rules

Prefer:

- Solidity for contracts;
- TypeScript for scripts/frontend;
- viem for EVM interaction;
- `@noble/post-quantum` for browser/local SLH-DSA support if compatibility remains proven;
- minimal dependencies;
- explicit types;
- deterministic serialization;
- small modules;
- readable event names;
- custom Solidity errors where useful.

Avoid:

- unnecessary frameworks;
- hidden magic;
- upgradeability unless explicitly approved;
- proxy contracts in V1;
- generic abstraction layers that hide security-critical logic;
- dependencies that require paid infrastructure.

---

## Mainnet Spending Rule

Before every new type of paid mainnet action:

1. simulate/read-only call where possible;
2. run `eth_estimateGas`;
3. calculate projected USDC cost;
4. confirm expected behavior;
5. broadcast only the minimum number of transactions needed.

Do not repeatedly broadcast a known-good action just for reassurance.

Keep the development wallet lightly funded.

---

## Testing Requirements

Each phase must include relevant:

### Local tests
- contract unit tests;
- encoding/hash tests;
- nonce tests;
- deadline tests;
- signature mutation tests.

### Arc Mainnet checks
Only after local tests pass:
- deploy or call the intended mainnet component;
- use tiny USDC values;
- record transaction hashes and gas;
- confirm explorer/RPC behavior.

Tests must include negative paths, not only successful flows.

---

## Phase Gate Rule

Never begin the next phase until:

- current phase acceptance criteria pass;
- tests pass;
- typecheck passes;
- build passes where applicable;
- mainnet checks required by the phase pass;
- no secrets are exposed;
- `Q2FA_PROJECT_STATE.md` is updated.

Stop after each phase and report:

- what changed;
- tests run;
- mainnet transactions;
- gas/USDC spent;
- unresolved issues;
- whether the phase passed.

---

## Review Checkpoints

Use a stronger review pass at:

1. smart-contract security model completion;
2. first successful two-factor mainnet withdrawal;
3. owner/guardian rotation completion;
4. final MVP before submission.

Review should specifically inspect:

- signature domain separation;
- replay protection;
- nonce handling;
- deadlines;
- state-change ordering;
- reentrancy;
- authorization bypasses;
- PQ verification assumptions;
- key exposure;
- event correctness;
- mainnet-specific behavior.

---

## Definition of Done

Q2FA V1 is done only when:

- a Q2FA smart account is live on Arc Mainnet;
- it can hold USDC;
- EVM-only withdrawal is blocked;
- EVM + valid PQ approval can withdraw to Wallet B;
- tampered authorization is blocked;
- replay is blocked;
- expiry is enforced;
- owner change requires both factors;
- guardian change requires both factors;
- the dashboard clearly shows protected balance and security status;
- the stolen-wallet demo is understandable in under 15 seconds;
- all required tests pass;
- documentation matches the deployed behavior.
