# Q2FA Phase 0 — Arc Mainnet PQ Feasibility

## Result
PASS

## Network
- Chain ID: 5042
- RPC used: https://rpc.mainnet.arc.io
- PQ verifier: 0x1800000000000000000000000000000000000004

## Wallet
- Wallet A public address only: 0x90e3a58694e953f5eC4018fF7dd57BE036f11FcE
- Wallet A signer match: PASS
- Native Arc balance at check: 0.26 USDC (native 18-decimal units)
- Current base fee: 20 gwei (20000000000 wei)
- Current suggested gas price: 20.000001151 gwei (20000001151 wei)

## PQ Compatibility
- Algorithm: SLH-DSA-SHA2-128s (FIPS 205)
- Verifying-key bytes: 32 (Arc expects 32)
- Signature bytes: 7856 (Arc expects 7856)
- Message format: UTF-8 bytes, no trailing newline: `Q2FA_PHASE0_ARC_MAINNET_V1\nchainId=5042\nwalletA=0x90e3a58694e953f5eC4018fF7dd57BE036f11FcE`
- Exact message bytes (hex): 0x513246415f5048415345305f4152435f4d41494e4e45545f56310a636861696e49643d353034320a77616c6c6574413d307839306533613538363934653935336635654334303138664637646435374245303336663131466345
- Local signature verification: PASS
- ABI calldata bytes: 8196

## Verification Results
- Valid signature: true
- Tampered message: false
- Corrupted signature: false

## Mainnet Transaction
- Transaction hash: 0xe8cd5e3511039e3e715d82fba3b389ce00302822b63263308691102d61bbc0b5
- Broadcast attempt consumed: YES
- Block: 24762876 (0x179d9fc)
- Status: success
- Gas used: 379274
- Effective gas price: 20 gwei (20000000000 wei)
- Actual fee in native units: 7585480000000000 wei
- Exact USDC network fee: 0.00758548 USDC (native USDC accounting, 18 decimals)
- Current-price fee projection: 0.007669020441352101 USDC at suggested 20.000001151 gwei
- Conservative maximum fee ceiling: 0.018405681059246884 USDC (18405681059246884 wei) (max fee per gas: 40.000002302 gwei (40000002302 wei))
- Observed confirmation/finality behavior: Receipt returned 1507 ms after broadcast at block 24762876 and that block hash was readable. The first immediate head query lagged one block at 24762875; a later read-only RPC check returned head 24763116 (241 blocks including the receipt). Arc documents deterministic finality; no additional confirmation depth was required.
- Arc explorer cross-check: [Explorer transaction page](https://explorer.arc.io/tx/0xe8cd5e3511039e3e715d82fba3b389ce00302822b63263308691102d61bbc0b5) independently showed Success, Wallet A as sender, the PQ verifier as destination, value 0 USDC, block 24762876, fee 0.00758548 USDC, and 81 block confirmations. It displayed confirmation in under 0.5 seconds.

## Findings
- Circle's Arc node source exposes the verifier at the expected precompile and confirms malformed lengths revert while validly encoded incorrect signatures return false.
- The initial receipt poll slightly preceded the RPC's head view; a later RPC read and the Arc explorer both placed the transaction well behind the observed head, with no reorg observed.
- The one broadcast call used value 0; the observed network fee was the only intentional Phase 0 spend.
- The script records the broadcast attempt before sending and refuses to broadcast again on rerun.
- The EVM private key was read only from DEPLOYER_PRIVATE_KEY; neither private key was printed, persisted, or sent to Arc. The disposable PQ secret buffer was zeroed after signing.

## Implications for Q2FA
The Arc Mainnet PQ verifier accepted a locally generated SLH-DSA-SHA2-128s signature, rejected both tampering cases, and completed one zero-value verification transaction. This supports using the verifier as the PQ factor in a smart-account design, provided the account separately enforces the EVM owner factor and requires both checks before authorizing movement.

## Phase 1 Recommendation
Proceed to architecture design for enforcing both factors in one smart account.

## References
- [Circle Arc Mainnet connection details](https://docs.arc.io/arc/references/connect-to-arc)
- [Circle Arc gas and fees](https://docs.arc.io/arc/references/gas-and-fees)
- [circlefin/arc-node PQ precompile implementation](https://github.com/circlefin/arc-node/blob/main/crates/pq-precompile/src/lib.rs)
- [circlefin/arc-node PQ precompile integration tests](https://github.com/circlefin/arc-node/blob/main/crates/precompiles/src/pq.rs)
- [noble-post-quantum SLH-DSA documentation](https://github.com/paulmillr/noble-post-quantum)
