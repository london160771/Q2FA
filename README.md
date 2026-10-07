# Q2FA

Q2FA is being built as a non-custodial Arc Mainnet smart account with two independent authorization factors: an EVM owner wallet and a client-side SLH-DSA-SHA2-128s guardian. Only USDC held by the Q2FA account is protected.

The Phase 0 Mainnet PQ verifier feasibility result is recorded in [PHASE0_RESULTS.md](PHASE0_RESULTS.md). Phase 1 is limited to the smart-account core and a minimal application scaffold. It does not add a dashboard or a custodial backend.

## Workspace layout

- `frontend/` — minimal React, TypeScript, and Vite shell with an injected Arc Mainnet wallet connector.
- `backend/` — TypeScript scripts and read-only Arc RPC utilities. It does not custody or sign on behalf of users.
- `contracts/` — Solidity account, Arc precompile interface, Hardhat configuration, and local tests.
- `shared/` — Arc Mainnet constants and the canonical binary authorization encoder.
- `scripts/phase0-pq-mainnet.ts` — preserved Phase 0 script; do not rerun its broadcast path.

## Local checks

Install dependencies with `npm install`, then run:

```powershell
npm run check
npm run gas:contracts
```

Hardhat uses the local `solc` npm package, so Solidity compilation does not need to fetch a compiler. Its Solidity tests run against a local EVM and a mock for Arc's built-in PQ verifier; Mainnet behavior is verified separately.

## Arc Mainnet

- Chain ID: `5042`
- RPC: `https://rpc.mainnet.arc.io`
- PQ verifier: `0x1800000000000000000000000000000000000004`
- USDC ERC-20 interface: `0x3600000000000000000000000000000000000000` (6 decimals)

Use the USDC ERC-20 interface for account deposits, balances, and withdrawals. Arc's native balance is the same USDC pool exposed with 18-decimal precision for gas accounting and `msg.value`.

Never put a deployer key or guardian secret in source code, frontend code, logs, or project documents. Local deploy scripts read the EVM key from `DEPLOYER_PRIVATE_KEY`; development guardian material stays in the ignored local `.env` file.
