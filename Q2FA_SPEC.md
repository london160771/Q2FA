# Q2FA — SPEC

## 1. Product

Q2FA is a protected smart account on Arc Mainnet.

It stores USDC behind two independent authorization factors:

1. the user's normal EVM owner wallet;
2. an SLH-DSA-SHA2-128s post-quantum guardian.

A stolen EVM private key alone must not be sufficient to move protected funds.

---

## 2. Problem

A normal self-custody wallet has a single critical failure point:

> Whoever controls the private key controls the money.

If that EVM key is stolen, the attacker can normally transfer the wallet's assets.

Q2FA changes the security model for funds placed inside the protected account.

The normal EVM wallet becomes **one authorization factor**, not the sole authority.

---

## 3. Product Promise

> Even if your normal wallet key is stolen, the USDC inside your Q2FA account cannot move without the second post-quantum approval.

Q2FA does **not** protect assets left directly inside the user's normal EVM wallet.

---

## 4. Why Arc

Arc is essential to Q2FA V1 because its Mainnet exposes an SLH-DSA-SHA2-128s post-quantum verifier as a protocol-level precompile.

Phase 0 proved on Arc Mainnet that:

- chain ID `5042` is reachable;
- the PQ verifier works at `0x1800000000000000000000000000000000000004`;
- a locally generated `32-byte` verifying key is accepted;
- a `7,856-byte` signature is accepted;
- valid signatures return `true`;
- tampered messages return `false`;
- corrupted signatures return `false`;
- one real verification used `379,274` gas at `20 gwei`;
- that verification cost `0.00758548 USDC`.

Q2FA therefore uses a real Arc-native capability rather than simulating post-quantum verification in application code.

---

## 5. Target User

Primary V1 user:

- a crypto user or developer holding USDC who wants stronger protection than a single EVM key.

Secondary future users may include:

- treasuries;
- teams;
- agents;
- high-value smart-account users.

These are not separate V1 flows.

---

## 6. V1 User Flow

### 6.1 Connect

User connects a normal EVM wallet.

The app verifies:
- Arc Mainnet network;
- connected owner address;
- that wallet's factory-registered account, if one exists;
- otherwise it shows the account-creation onboarding state.

With no connected wallet, the app shows no active user account. A documented demo deployment is not used as a fallback.

### 6.2 Generate guardian

The browser/client generates an SLH-DSA-SHA2-128s keypair locally.

The private key must stay client-side.

The public key is registered with the Q2FA account only after the user has exported and restored the backup locally. The seed remains client-side and account creation is gated on the restore check.

The UI must clearly warn the user that losing the guardian secret can lock protected operations.

### 6.3 Create Q2FA account

User creates a Q2FA smart account through `Q2FAAccountFactory.createAccount(guardianKey)`.

The factory derives the owner from `msg.sender`, records one account per owner, and exposes `accountOf(owner)` for discovery. The frontend never supplies an owner address to claim.

The account records:
- EVM owner;
- PQ guardian public key;
- nonce state.

Creating a second factory account for the same current owner is rejected. When an account owner is changed through the existing two-factor protected action, its factory discovery record moves atomically; a change to an owner who already has an account is rejected.

### 6.4 Deposit

User deposits USDC into the Q2FA smart account.

Deposits do not require the PQ factor.

### 6.5 Withdraw

User chooses:
- recipient;
- amount;
- deadline.

The app creates a deterministic protected-action payload.

The PQ guardian signs that exact payload.

The EVM owner submits/authorizes the transaction.

The smart account verifies:
- correct EVM owner;
- correct action payload;
- valid PQ signature;
- correct nonce;
- unexpired deadline.

Only then does the account transfer USDC.

### 6.6 Rotate owner

Changing the owner requires:
- current EVM owner authorization;
- valid PQ guardian authorization.

### 6.7 Rotate guardian

Changing the PQ guardian requires:
- current EVM owner authorization;
- current valid PQ guardian authorization.

---

## 7. Required Protected Payload

Every protected action must bind:

```text
chainId
account
action
recipient_or_subject
amount
nonce
deadline
```

The implementation may use a structured ABI-encoded or typed-hash representation, but it must be deterministic and documented.

For owner/guardian rotation, `recipient_or_subject` represents the new owner or new guardian value as appropriate.

---

## 8. Functional Requirements

### Account
- deploy/create account;
- read owner;
- read guardian;
- read nonce;
- read protected USDC balance.

### Deposits
- receive/hold USDC;
- show updated protected balance.

### Withdrawals
- create exact authorization;
- produce PQ signature locally;
- verify PQ signature through Arc precompile;
- require EVM owner;
- consume nonce;
- enforce deadline;
- transfer USDC;
- emit activity event.

### Owner rotation
- require both factors;
- set new owner;
- emit event.

### Guardian rotation
- require both factors;
- set new guardian;
- emit event.

### Dashboard
Must show:
- protected balance;
- owner address;
- guardian enabled state;
- current security status;
- pending/prepared withdrawal details;
- both-factor verification state during withdrawal;
- recent Q2FA activity;
- stolen-wallet demonstration state.

---

## 9. Security Acceptance Criteria

V1 must demonstrate all of the following:

### Valid path
- correct EVM owner + correct PQ signature => protected action succeeds.

### Missing factor
- EVM owner without PQ signature => blocked.
- PQ signature without valid EVM owner => blocked.

### Tampering
After PQ signing:
- change recipient => blocked;
- change amount => blocked;
- change action => blocked;
- change account => blocked;
- change chain => invalid by domain design.

### Replay
- successful authorization cannot be reused;
- old nonce fails.

### Expiry
- authorization after its deadline fails.

### Administration
- owner rotation requires both factors;
- guardian rotation requires both factors.

---

## 10. Dashboard Demo

The primary demo should be understandable without blockchain knowledge.

### Scene A — protected funds

```text
Protected balance: $X
Owner wallet: connected
PQ Guardian: active
Security: 2/2 required
```

### Scene B — simulate stolen wallet

Attacker/owner-key-only attempt:

```text
EVM factor: VALID
PQ factor: MISSING
RESULT: BLOCKED
```

Protected balance remains unchanged.

### Scene C — legitimate send

```text
EVM factor: VALID
PQ factor: VALID
RESULT: APPROVED
```

A tiny USDC amount reaches Wallet B.

---

## 11. Non-Goals

V1 will not include:

- protection for funds held directly in the user's EOA;
- spending tiers;
- daily limits;
- social recovery;
- paymasters;
- gas sponsorship;
- account abstraction bundlers;
- AI;
- custodial key storage;
- backend signing;
- cross-chain transfers;
- multi-guardian voting;
- insurance;
- testnet migration flow;
- mobile app;
- enterprise policy engine.

---

## 12. Cost Constraint

Q2FA should remain cheap enough to build and demonstrate directly on Arc Mainnet.

Phase 0 reference:
- PQ verification: `379,274 gas`
- actual fee: `0.00758548 USDC`

All development broadcasts should:
- use small values;
- be estimated before sending;
- be minimized.

---

## 13. V1 Success Criteria

V1 succeeds when a judge can see, on Arc Mainnet:

1. USDC exists inside the Q2FA account.
2. A wallet-only withdrawal is rejected.
3. A wallet + PQ-approved withdrawal succeeds.
4. Wallet B receives the tiny demo payment.
5. Replays/tampering are blocked.
6. The dashboard makes the two-factor model obvious within 15 seconds.
