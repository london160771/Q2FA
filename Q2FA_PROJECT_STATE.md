# Q2FA Project State

## Status

**Phase 1 — Smart Account Core: PASS.**

The Phase 1 local review and Arc Mainnet gate completed. Stop here pending review; the next planned phase is Phase 2 — Guardian Client + End-to-End Authorization.

## Network and Wallet

- Network: Arc Mainnet only
- Chain ID: `5042`
- RPC: `https://rpc.mainnet.arc.io`
- Arc PQ verifier: `0x1800000000000000000000000000000000000004`
- Arc USDC ERC-20 interface: `0x3600000000000000000000000000000000000000`
- Wallet A public address: `0x90e3a58694e953f5eC4018fF7dd57BE036f11FcE`
- Wallet B was not used in Phase 1.

## Repository Structure Created

```text
frontend/   React, TypeScript, Vite, lightweight injected-wallet connector
backend/    Node.js/TypeScript, Arc RPC helpers, read-only inspector, local deploy/probe script
contracts/  Solidity account, interfaces, Hardhat tests/configuration
shared/     Arc Mainnet constants and deterministic authorization encoding
scripts/    Preserved Phase 0 script
```

Root npm workspaces coordinate the four packages. The frontend is a minimal placeholder only. There is no database, server authentication, hosted service, proxy, or frontend dashboard.

## Contract Architecture Implemented

- `Q2FAAccount` stores only `owner`, a `bytes32` SLH-DSA verifying key, and `nonce`.
- Protected methods are limited to `withdraw`, `changeOwner`, and `changeGuardian`.
- Each protected action requires the current EVM owner and a valid current guardian approval.
- The 256-byte authorization message is deterministic `abi.encode` data binding `Q2FA_AUTH_V1`, chain ID, account address, action, subject, amount, nonce, and deadline.
- Arc's fixed SLH-DSA verifier and Arc's fixed USDC ERC-20 interface are called directly. ERC-20 USDC transfers are the deposit and withdrawal path; deposits require no PQ approval.
- No owner-only withdrawal bypass or arbitrary execution method exists.
- The local development deploy script generates a fresh Phase 1 guardian and keeps its seed only in the ignored local `.env`; it is not production guardian UX or a hosted signing service.

Arc documentation confirms the USDC ERC-20 interface uses six decimals, shares its underlying balance with the 18-decimal native gas interface, and is the recommended interface for application transfers. Circle's current `arc-node` source confirms the PQ verifier ABI, 32-byte key, 7,856-byte signature, and boolean `false` for a well-formed invalid signature. It labels the PQ verifier experimental and recommends pairing PQ checks with classical authentication; Q2FA enforces the owner transaction as that second factor.

## Local Checks and Security Review

- Root typecheck: passed for Phase 0 and all workspaces.
- Workspace production builds: passed, including Vite, backend/shared TypeScript, and Solidity compilation.
- Frontend Vite dev server: started on localhost and returned HTTP 200 with the Q2FA page.
- Backend tests: 2 passed, including local SLH-DSA-SHA2-128s key generation, 32-byte public key, 7,856-byte signature, valid verification, and message/signature tampering failures.
- Solidity tests: 26 passed, covering valid authorization, both factors, action/domain tampering, replay/nonce, expiry, owner/guardian changes, malformed or invalid signatures, verifier failures, transfer rollback, deposits, reentrancy callback, and events.
- Hardhat gas report: completed. The local PQ verifier was mocked for contract tests; Mainnet gas is recorded below from actual receipts.
- Dependency audit: zero known vulnerabilities reported after pinning the affected transitive `tmp` dependency to `0.2.7`.
- Dedicated code review found no unresolved critical or high issue in payload/domain binding, verifier interaction, nonce/deadline handling, authorization on all three methods, or withdrawal state/transfer ordering.

Residual risks: the Arc PQ precompile is documented as experimental; local Solidity tests mock its cryptographic implementation, while the Mainnet protected-withdrawal probe below provides the live integration check. Production client-side guardian generation, backup, and signing UX remain unimplemented. The development guardian is not a production key.

## Arc Mainnet Deployment and Interaction

Signer preflight resolved to Wallet A. Initial native gas balance was `0.25241452 USDC`; current base fee was `20 gwei`. The transaction script simulated/estimated each action, verified chain and signer before every broadcast, and kept maximum-fee exposure below its `0.10 USDC` Phase 1 cap.

Phase 0 remains **PASS** and was not rerun in Phase 1. Its prior transaction is recorded in `PHASE0_RESULTS.md`: `0xe8cd5e3511039e3e715d82fba3b389ce00302822b63263308691102d61bbc0b5`, block `24762876`, `379,274` gas, `20 gwei`, `0.00758548 USDC` fee.

Deployed Q2FA account:

`0xc27bd794db0e7d2cf636fbd7872d05e92cc295d2`

Verified deployed state:

- Owner: `0x90e3a58694e953f5eC4018fF7dd57BE036f11FcE`
- Development guardian public key: `0xcb95353dfb1a6daf602f242d2509a24d4bfecae71d59ef246327365c7d8758a1`
- Final nonce: `1`
- Final account USDC ERC-20 balance: `0`

Transactions (all status `success`, effective gas price `20 gwei`):

| Action | Transaction hash | Block | Gas used | Exact network fee |
| --- | --- | ---: | ---: | ---: |
| Deploy account | `0x33c0816c43665ddb38fdfe8743a3ba9275517f91d8c36e3eb8b2b7ecd5cac529` | 24773431 | 621,069 | 0.01242138 USDC |
| Deposit 1 ERC-20 base unit | `0x097e2339d8186eea68f88b2ea8d7291df41a8c76514e8bdea47f70af0612284c` | 24773437 | 48,926 | 0.00097852 USDC |
| PQ-protected withdrawal to Wallet A | `0xe0ad7b52b6b18ae507d722d5fa2564c009a33ec2282971d5a640d4cb5f169d0c` | 24773456 | 440,662 | 0.00881324 USDC |

The probe deposited and withdrew `1` ERC-20 base unit (`0.000001 USDC`) and left the Q2FA account balance at zero. Phase 1 total gas used was `1,110,657`; Phase 1 actual Mainnet network fees were `0.02221314 USDC` (`22,213,140,000,000,000` native units). Including the Phase 0 fee, cumulative project Mainnet fees are `0.02979862 USDC`. No funds were sent to Wallet B.

## Issues Discovered and Fixes

- Foundry was not installed in the Windows environment, so Phase 1 uses Hardhat 3 with Solidity tests and gas reporting.
- The sandboxed Node process could not access OS user information required by Hardhat/tsx; local checks used a temporary Windows-only shim, which was removed after verification.
- Vite's dev dependency scanner needed access beyond the frontend package in the sandbox; the local dev-server smoke check succeeded with the workspace tool's authorized local execution.
- Mainnet USDC has two decimal interfaces over one balance. The contract uses the documented six-decimal ERC-20 path for application transfers, avoiding native-value/USDC-decimal ambiguity.

## Exact Next Phase

**Phase 2 — Guardian Client + End-to-End Authorization.** Begin only after review of this Phase 1 result. Implement the client-side guardian flow and complete the next phase's specified tests; do not expand scope beyond `Q2FA_PLAN.md`.
