# Q2FA — DESIGN

## 1. Architecture Overview

```text
                 ┌──────────────────────┐
                 │      Q2FA UI         │
                 │                      │
                 │ EVM wallet session   │
                 │ PQ guardian client   │
                 └──────────┬───────────┘
                            │
                  protected action data
                            │
            ┌───────────────┴───────────────┐
            │                               │
     EVM owner authorization          PQ signature
            │                               │
            └───────────────┬───────────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │  Q2FA Smart Account │
                 │     Arc Mainnet      │
                 │                      │
                 │ owner check          │
                 │ nonce/deadline       │
                 │ PQ precompile call   │
                 │ USDC transfer        │
                 └──────────┬───────────┘
                            │
                            ▼
                     Recipient wallet
```

The protected USDC lives in the Q2FA smart account.

The normal EVM wallet is Factor 1.

The locally held post-quantum guardian is Factor 2.

---

## 2. Arc Mainnet Dependencies

### Network
- Chain ID: `5042`
- RPC: `https://rpc.mainnet.arc.io`

### PQ verifier
- Address: `0x1800000000000000000000000000000000000004`
- Algorithm: `SLH-DSA-SHA2-128s`
- Verifying key: `32 bytes`
- Signature: `7,856 bytes`

### Phase 0 evidence
- successful mainnet PQ verification;
- gas used: `379,274`;
- effective gas price: `20 gwei`;
- exact fee: `0.00758548 USDC`.

The smart account should call the Arc precompile rather than implement SLH-DSA verification in Solidity.

---

## 3. Smart Account State

Minimum conceptual state:

```solidity
address public owner;
bytes32 public guardianKey;
uint256 public nonce;
```

Exact representation may change if the verifier interface requires dynamic `bytes`, but the stored guardian should use the smallest safe form consistent with Arc's `32-byte` verifying key.

If Arc USDC transfer semantics require a specific native/ERC-20 path, implementation must verify the correct mainnet behavior before locking transfer code.

---

## 4. Protected Actions

Use explicit action types.

Example:

```text
WITHDRAW
CHANGE_OWNER
CHANGE_GUARDIAN
```

Avoid generic arbitrary execution in V1.

Generic `execute(target,data)` increases attack surface and is out of scope unless explicitly approved.

---

## 5. Authorization Message

The PQ guardian must sign a deterministic payload representing one exact action.

Conceptual schema:

```text
Q2FA_AUTH_V1
chainId
account
action
subject
amount
nonce
deadline
```

Where:

- `chainId` = `5042`;
- `account` = this Q2FA contract;
- `action` = protected operation identifier;
- `subject` = recipient/new owner/new guardian representation;
- `amount` = withdrawal amount, otherwise `0` if not needed;
- `nonce` = current action nonce;
- `deadline` = authorization expiry.

Recommended implementation:

```solidity
keccak256(
    abi.encode(
        Q2FA_AUTH_TYPEHASH,
        block.chainid,
        address(this),
        action,
        subject,
        amount,
        nonce,
        deadline
    )
)
```

The exact byte payload sent to SLH-DSA must be identical between frontend/client and contract.

Do not depend on ambiguous string concatenation.

---

## 6. Domain Separation

Domain separation is mandatory.

A signature created for one Q2FA account must not work on another.

A signature created for another chain must not work on Arc.

At minimum bind:

- chain ID;
- contract address;
- schema/version prefix.

Example domain label:

```text
Q2FA_AUTH_V1
```

Any future schema change must use a new version identifier.

---

## 7. Withdrawal Flow

### Step 1
User enters:
- recipient;
- amount;
- deadline.

### Step 2
Frontend reads current nonce from Q2FA account.

### Step 3
Frontend constructs exact authorization bytes.

### Step 4
PQ guardian signs authorization bytes locally.

### Step 5
EVM owner submits:

```text
withdraw(
    recipient,
    amount,
    deadline,
    pqSignature
)
```

The nonce may be read from state rather than passed if that reduces ambiguity.

### Step 6
Contract checks:
1. `msg.sender == owner`;
2. deadline is valid;
3. constructs exact expected authorization;
4. verifies PQ signature using stored guardian public key;
5. increments nonce;
6. transfers USDC;
7. emits event.

Use checks-effects-interactions ordering.

---

## 8. Replay Protection

A monotonic nonce is required.

For every successful protected action:

```text
nonce = nonce + 1
```

The nonce must be part of the PQ-signed payload.

A signature for nonce `N` must fail after nonce `N` has been consumed.

Failed transactions must not accidentally consume the nonce unless explicitly designed that way.

---

## 9. Expiry

Each protected authorization includes a deadline.

Contract rule:

```text
block.timestamp <= deadline
```

Expired authorizations fail.

UI should show expiry clearly.

Keep demo expiry generous enough to avoid frustrating manual testing.

---

## 10. Owner Rotation

Conceptual flow:

```text
changeOwner(
    newOwner,
    deadline,
    pqSignature
)
```

Requirements:
- caller is current owner;
- signed action is `CHANGE_OWNER`;
- signed subject is `newOwner`;
- nonce matches;
- deadline valid;
- PQ signature valid.

After success:
- update owner;
- increment nonce;
- emit `OwnerChanged`.

Reject zero address.

---

## 11. Guardian Rotation

Conceptual flow:

```text
changeGuardian(
    newGuardian,
    deadline,
    pqSignature
)
```

Requirements:
- caller is current owner;
- current guardian approves the change;
- signed action is `CHANGE_GUARDIAN`;
- signed subject commits to the new guardian;
- nonce matches;
- deadline valid.

After success:
- set new guardian;
- increment nonce;
- emit `GuardianChanged`.

The new guardian must not authorize its own installation without the current guardian.

---

## 12. Deposit Model

Deposits should be simple.

A deposit does not need both factors because it increases protected funds rather than releasing control.

The UI must distinguish:

- EOA balance;
- Q2FA protected balance.

Do not imply Q2FA protects assets that remain in the normal EVM wallet.

---

## 13. PQ Key Handling

### Generation
Generate guardian keypair locally in the browser/client.

### Public key
Safe to register onchain.

### Private key
Must never:
- leave the user's device intentionally;
- reach the smart contract;
- be sent to an API;
- be logged;
- enter source control.

### V1 backup UX
The app may provide a local download/export mechanism for the guardian secret if implemented securely.

Do not build cloud backup in V1.

The UI must clearly warn:

> Losing the guardian key may prevent protected actions.

Do not make recovery claims V1 does not support.

---

## 14. Frontend Design

Suggested stack:
- React;
- TypeScript;
- viem;
- wallet connector compatible with Arc;
- `@noble/post-quantum`.

Core screens:

### Setup
- connect wallet;
- confirm Arc Mainnet;
- generate/register guardian;
- create/deploy Q2FA account.

### Dashboard
- protected balance;
- owner;
- guardian status;
- nonce/security state;
- deposit;
- send;
- activity.

### Send
- recipient;
- amount;
- deadline;
- exact authorization preview;
- PQ sign;
- EVM submit;
- result.

### Security Demo
- wallet-only attempt;
- blocked result;
- legitimate two-factor attempt;
- successful result.

---

## 15. Event Model

Minimum useful events:

```solidity
event Deposited(address indexed from, uint256 amount);

event WithdrawalExecuted(
    address indexed recipient,
    uint256 amount,
    uint256 nonce
);

event OwnerChanged(
    address indexed previousOwner,
    address indexed newOwner,
    uint256 nonce
);

event GuardianChanged(
    bytes32 previousGuardian,
    bytes32 newGuardian,
    uint256 nonce
);
```

Adjust event parameters to the final data representation.

Events should support dashboard activity without requiring a custom backend.

---

## 16. Threat Model

### Threat: owner private key stolen
Attacker can sign normal EVM transactions.

Expected result:
- cannot withdraw protected USDC without guardian;
- cannot change owner;
- cannot change guardian.

### Threat: PQ guardian stolen
Attacker has PQ secret but not EVM owner key.

Expected result:
- cannot execute protected actions because the contract also requires owner authorization.

### Threat: authorization tampering
Attacker modifies recipient/amount/action.

Expected result:
- PQ verification fails because exact action data changed.

### Threat: replay
Attacker reuses old valid PQ signature.

Expected result:
- nonce mismatch blocks execution.

### Threat: delayed submission
Attacker waits and submits later.

Expected result:
- deadline blocks expired authorization.

### Threat: cross-account reuse
Attacker submits signature to another Q2FA account.

Expected result:
- account address domain binding invalidates it.

### Threat: cross-chain reuse
Expected result:
- chain ID binding invalidates it.

### Threat: compromised frontend
V1 cannot fully solve a malicious frontend.

Mitigation:
- show exact recipient/amount before guardian signing;
- deterministic signing payload;
- open-source client;
- avoid backend signing.

---

## 17. Contract Safety

Required:
- reentrancy protection where transfer path makes it relevant;
- checks-effects-interactions;
- zero-address checks;
- nonce correctness;
- exact signature length/key length assumptions;
- explicit verifier return handling;
- no arbitrary delegatecall;
- no upgrade proxy in V1;
- no owner-only emergency bypass.

There must be **no hidden path** that lets the EVM owner move protected funds without PQ approval.

---

## 18. Dashboard Design Principle

The main security state should be visible immediately:

```text
Protected balance
$X

Factor 1 — EVM owner     ACTIVE
Factor 2 — PQ guardian   ACTIVE

Protection
2 / 2 REQUIRED
```

The stolen-wallet demo should visually show:

```text
EVM authorization       ✓
PQ authorization        ✕
WITHDRAWAL BLOCKED
```

Then:

```text
EVM authorization       ✓
PQ authorization        ✓
WITHDRAWAL APPROVED
```

The judge should understand the product in under 15 seconds.
