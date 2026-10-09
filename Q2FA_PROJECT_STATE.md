# Q2FA Project State

## Status

**Phase 1 — Smart Account Core: PASS (historical).**

**Phase 2 clean redeploy: PASS — complete.** The original Phase 1/early Phase 2 account `0xc27bd794db0e7d2cf636fbd7872d05e92cc295d2` remains an abandoned development deployment and must not be used. The fresh account below completed guardian backup/restore, deposit, read-only simulations, and protected withdrawal to Wallet B.

**Phase 3 — Dashboard: PASS.** Activity reads real Arc Mainnet logs through bounded, topic-filtered direct RPC pages. Both live Security Demo simulations were verified against the deployed account using read-only `eth_call`; the EVM-only attempt was blocked and the active guardian authorization was accepted. No Mainnet transaction was sent during Phase 3 verification.

**Phase 3.5 — Layout + Visual Redesign: PASS.** Nested routing, the fixed application shell, separate Deposit and Docs pages, and the graphite/cyan visual system are complete. Phase 4 has not started.

**Phase 3.6 — Multi-user Q2FA Accounts: local implementation complete; Mainnet factory deployment pending separate review and authorization.** The product no longer treats the original demo account as a default user account. Factory-based discovery and onboarding are implemented locally, but live multi-user account creation is not enabled because the factory has not been deployed.

## Phase 3 Dashboard — Complete

- Implemented the four requested dashboard sections: Security Overview, Send USDC, Activity, and Security Demo. The overview reads owner, guardian, nonce, and protected USDC balance live from the deployed account and Arc Mainnet. It explains the two required factors and warns that funds in the normal wallet are not protected.
- Preserved the local guardian seed import flow. The client derives the guardian locally, compares it with the live onchain key, rejects a mismatch, and keeps imported material in memory only. No browser storage or backend custody was added.
- The send flow uses the shared canonical authorization encoding, presents the action details, signs with the imported guardian, simulates and estimates before submission, and displays the estimated/actual Arc fee in USDC. Wrong network and non-owner wallet states gate protected submission. The UI does not hardcode Wallet B as the main recipient.
- Added an onchain Activity feed for deposits, protected withdrawals, owner changes, and guardian changes. The RPC returns `-32012: requested range too large` for one request spanning deployment block `24896834` through the current head. One-block and 100-block reads succeed; exact-topic reads over 10,000-block pages also succeed. The client now scans from deployment in up-to-10,000-block pages, filters by the Q2FA address and event topics (and USDC `Transfer` with the Q2FA address as recipient), adds a 750ms gap between pages, halves pages on range-limit errors, and retries rate limits.
- The updated Activity view displayed verified Mainnet data: the `0.000001 USDC` deposit at block `24906205` (transaction `0x250b846795c302a8dd67c5b46063379d6527a85196e91771d5ac1d36c2e95c26`) and protected withdrawal at block `24906981` (transaction `0xb883911a18724ef6a31ed6f9ca3f54a13847ca5413b2efcd69fa18eb76e2e56a`). The feed resolved actual receipts, timestamps, and gas fees. No activity was hardcoded and no database was added.
- Public indexer fallback checks: Arc Explorer API requests returned HTTP 403; Arcscan's public API returned HTTP 530 (Cloudflare tunnel unavailable). No paid service, API key, or indexer dependency was added.
- Split the Security Demo into independent buttons so the missing-guardian case can be run before restore. The live read-only stolen-wallet simulation used Wallet A as `msg.sender` and an empty PQ signature; Arc rejected it with `InvalidPQSignatureLength(0)`. The live two-factor simulation used the guardian imported in the browser, signed the exact current `CHANGE_GUARDIAN` payload, and returned **AUTHORIZED** from Arc Mainnet `eth_call`. The same-key authorization was simulated only; no transaction was submitted. Onchain nonce remained `1` and guardian key remained unchanged after both simulations. The seed was not read, accessed, or exposed by this task.
- Added dashboard logic/component tests. `npm run check` passed after the code changes: 15 frontend tests, 2 backend tests, and 26 Solidity tests passed, along with workspace typechecks and production builds. Vite emitted a size warning for the main minified JavaScript chunk (~563 KB, ~173 KB gzip); guardian crypto remains in a separate lazy-loaded chunk.
- Manually inspected desktop and 375px mobile layouts. At 375px, both Activity entries fit with no horizontal overflow; the Security Demo cards stack, buttons fit, and the document width remains 375px.
- No paid Mainnet transaction was submitted. No secrets were read, persisted, or exposed. No database or contract behavior was added.

Phase 3 verification is complete. No unresolved critical or high security issue was found in this phase. The main JavaScript bundle size warning remains a non-blocking optimization item; guardian cryptography is lazy-loaded separately. The guardian seed remains user-managed and memory-only in the client.

## Phase 3.5 Layout + Visual Redesign — Complete

- Replaced top-level tabs with nested React Router routes: `/` redirects to `/overview`; `/overview`, `/send`, `/deposit`, `/activity`, `/security`, and `/docs` render inside a shared `AppShell`.
- The shell uses a fixed, non-scrolling sidebar and header with an independently scrolling route outlet. On mobile the sidebar becomes an accessible drawer that closes after navigation and supports Escape. Browser back/forward and URL-based active navigation use React Router.
- Reworked the product styling into a graphite/charcoal security interface with icy cyan as the brand accent. Green is reserved for successful/active states. Factor 1 + Factor 2 = Protected action is shown consistently on Overview, Send, Security Demo, and Docs.
- Overview still reads live owner, guardian, nonce, and protected USDC from Arc Mainnet; includes guardian restore, protection limits, and an activity entry point. Send retains the existing local guardian signature, Arc simulation, gas estimate, and owner-wallet submission handlers. Activity retains the existing paginated direct-RPC event query.
- Moved the existing deposit flow to `/deposit` with separate live wallet/protected balances, the Arc fee preview, and an explicit explanation that protection starts only after USDC enters the Q2FA account. No deposit was submitted during this phase.
- Added a concise in-app Docs page with all 11 requested topics, including the deployed account and owner. It documents limits and user-managed guardian backup without making recovery or quantum-proof claims.
- Routing tests cover nested route rendering, active sidebar state, redirects, Deposit/Docs routes, shared header controls, and mobile-navigation semantics. Final `npm run check` passed: workspace typechecks/builds; 19 frontend tests; 2 backend tests; and 26 Solidity tests. `git diff --check` passed.
- Runtime incident verified and resolved on 2026-10-08: the prior Vite process returned HTTP `504 Outdated Optimize Dep` for its stale optimized `react-router-dom` module, so the browser could not evaluate `main.tsx` and `#root` stayed empty. A fresh local Vite server started with `--force` logged forced dependency re-optimization and mounted the unchanged app. No router/component code or Activity query logic needed modification.
- On the fresh dev server, `/` redirected to `/overview`; `/overview`, `/send`, `/deposit`, `/activity`, `/security`, and `/docs` all rendered after direct URL loads and refreshes. Browser back/forward and active sidebar navigation were verified. The reloaded `/activity` paginated scan displayed the real `0.000001 USDC` deposit and protected withdrawal with Arc transaction links; no transaction was sent and no activity logic was changed.
- Manually reviewed the production preview at 1440×900, 768×900, and 375×812. Sidebar and header remain fixed while the outlet scrolls; the mobile drawer opens, focuses the first navigation link, changes route, and closes. At 375px, the document width remained 375px with no horizontal or body-level vertical overflow; the route outlet scrolls independently.
- No contract, guardian, authorization, deployment, or Mainnet transaction behavior was changed. No database or secret persistence was introduced. The existing `/activity` page still reads real Arc data and the Phase 3 Mainnet events verified above remain the source; no history is hardcoded.

No critical/high issue was introduced. The Vite build still reports a non-blocking main JavaScript chunk size warning (about 597 KB minified, 184 KB gzip); PQ guardian code remains separately lazy-loaded. Phase 4 has not started.

## Phase 2 Clean Redeploy — Complete

- Result: **PASS**. Phase 2 is complete; its next planned phase was Phase 3 — Dashboard.
- The old account `0xc27bd794db0e7d2cf636fbd7872d05e92cc295d2` remains an abandoned development deployment. It was not recovered, weakened, reused, or redeployed over.
- A fresh SLH-DSA-SHA2-128s guardian was generated locally. Its seed was backed up outside source control before deployment, then restored and verified to reproduce the same public key. A local sign/verify round-trip passed. The active guardian seed remains outside source control; no secrets were committed.
- New guardian public key: `0xe2234e490c1a42c30104d059aad16473811694a715a33f31d8c8a0a9dabe4566`.
- Fresh Arc Mainnet account: `0xa40524d1e9380d3b82752ec4bc074cc7e6272fb0`.
- Deployment transaction: `0x49202da9dd6b7d1b233ccf039597672c01ae9d83cd24dd3240650add384056ad`; block `24896834`; status `success`; gas used `621,069`; effective gas price `20 gwei`; fee `0.01242138 USDC`.
- RPC readback confirmed owner Wallet A, the new guardian public key, and initial nonce `0`.
- The client restore/import flow works: importing the backed-up seed derives the active guardian locally, matches the deployed `guardianKey()`, and keeps the private material in memory only.
- Tiny deposit: `0.000001 USDC`; transaction `0x250b846795c302a8dd67c5b46063379d6527a85196e91771d5ac1d36c2e95c26`; network fee `0.000978520074416446 USDC`.
- Protected withdrawal to Wallet B: `0.000001 USDC`; transaction `0xb883911a18724ef6a31ed6f9ca3f54a13847ca5413b2efcd69fa18eb76e2e56a`; network fee `0.009402520715061646 USDC`. Wallet B received the stated amount. Nonce advanced exactly once, `0 → 1`.
- Read-only simulations passed: valid signature; changed recipient rejected; changed amount rejected; stale nonce rejected; expired authorization rejected; non-owner rejected; corrupted PQ signature rejected; changed action rejected.
- `npm run check` passed: 6 frontend tests, 2 backend tests, 26 Solidity tests, all workspace typechecks and builds.
- Deposit plus withdrawal network fees: `0.010381040789478092 USDC`. Phase 2 total including deployment: `0.022802420789478092 USDC`. Cumulative project network fees including recorded Phase 0/1 fees of `0.02979862 USDC`: `0.052601040789478092 USDC`.
- No further Mainnet action is required for Phase 2.

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
frontend/   React, TypeScript, Vite, live Arc dashboard and lightweight injected-wallet connector
backend/    Node.js/TypeScript, Arc RPC helpers, read-only inspector, local deploy/probe script
contracts/  Solidity account, interfaces, Hardhat tests/configuration
shared/     Arc Mainnet constants and deterministic authorization encoding
scripts/    Preserved Phase 0 script
```

Root npm workspaces coordinate the four packages. The frontend contains the Phase 3 dashboard and Phase 3.5 routed application shell. There is no database, server authentication, hosted service, or proxy.

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

Residual risks: the Arc PQ precompile is documented as experimental; local Solidity tests mock its cryptographic implementation, while the successful Phase 2 Mainnet withdrawal provides a live integration check. The Phase 2 guardian client is a development interface and still needs product-level usability and security review before production use. Guardian backup remains user-managed; there is no cloud recovery. The historical Phase 1 development guardian is not a production key.

## Historical Phase 1 Arc Mainnet Deployment and Interaction — Original Account Abandoned

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

## Phase 3.6 — Multi-user Account Architecture

- Added a minimal Arc Mainnet-only factory source. `createAccount(bytes32)` takes no owner argument; the account owner is `msg.sender`. Duplicate creation is rejected, `accountOf(owner)` exposes discovery, and `accountCreatedBlock(account)` supplies the correct Activity scan start.
- Factory-created accounts hold an immutable factory registry reference. A valid two-factor `changeOwner` atomically updates discovery; transfer to an owner who already has an account reverts the full owner change.
- The frontend now discovers the account for the connected wallet, verifies the live account owner, and scopes balances, guardian, nonce, withdrawal/deposit target, simulations, and Activity to that account. Disconnected users see a neutral connect state. No account is shown as active if factory discovery is unavailable.
- New-account onboarding generates the guardian in the browser, downloads a local seed file only after a user action, requires re-import and a local sign/verify round-trip before account creation, and keeps private material in tab memory.
- The old `0xa40524d1e9380d3b82752ec4bc074cc7e6272fb0` deployment remains an unchanged, unregistered legacy demo. It is explicitly labelled in Docs and is not a fallback for Wallet A or any other connected wallet.
- At the initial Phase 3.6 implementation review, the factory had not yet been deployed. It was later deployed with authorization and is now configured locally through the ignored `frontend/.env.local` file at `0x378330579a0c76215994e774b95a3413c2efba34`. Per-user account creation still requires the owner's own wallet transaction after guardian backup verification.
- Local validation passed: `npm run check` (25 frontend tests, 2 backend tests, 34 Solidity tests; typecheck and workspace builds passed), and `git diff --check` passed. Hardhat required the same temporary OS-user-info shim used by prior local checks; the shim was removed afterward. The frontend build retains a non-blocking large-bundle warning.
- Read-only Arc Mainnet estimate confirmed chain ID `5042`: factory creation bytecode `4,172` bytes; `eth_estimateGas` `954,802`; gas price `20,000,000,003 wei`; base fee `20,000,000,000 wei`; projected factory deployment fee `19,096,040,957,666,406` native units (`0.019096040957666406 USDC`). This was an estimate before deployment, not a transaction or spend. Account-creation gas remains unmeasured here.
- Phase 3.6 implementation validation itself sent no transaction. The recorded `0.052601040789478092 USDC` cumulative subtotal predates the later authorized factory deployment and excludes that deployment fee. This RPC verification added `0 USDC` in network fees.
- The deployment plan was later executed through a separately authorized transaction. The factory is at `0x378330579a0c76215994e774b95a3413c2efba34` and is configured locally through the ignored Vite environment file. Each user creation remains a separate owner-submitted transaction after local guardian backup verification.
- Migration impact: the existing direct-deployed demo account remains valid and untouched, but is not in the new factory registry. It will remain a labelled demo unless a separate explicit migration design is approved.
- Remaining live risks: live per-user account creation has not been exercised; the existing demo deployment cannot be discovered through the new factory. No Phase 4 work has started.

### Production RPC strategy verification — 2026-10-09

- The production build uses Arc Mainnet RPC directly at `https://rpc.mainnet.arc.io`; its bundled JavaScript contains the endpoint and excludes the Vite-only `/arc-rpc` route.
- A browser-hosted production-build probe in Chrome passed `eth_chainId`, factory and account `eth_call` reads, USDC `balanceOf`, and Activity `eth_getLogs` filters for account actions and USDC deposits against Arc Mainnet.
- The live `accountOf(Wallet A)` read returned zero, as expected for the existing direct-deployed legacy demo account, which is not registered in the factory.
- The Vite proxy remains dev-only because direct Arc reads had failed during this workspace's local review. It is not part of the production bundle. The production direct path passed browser verification, so no backend proxy or alternate RPC endpoint is needed.
- No transaction was sent for this verification.

**Phase 3.6 local implementation and factory deployment are complete; per-user account creation has not been exercised. Phase 4 has not started.**
