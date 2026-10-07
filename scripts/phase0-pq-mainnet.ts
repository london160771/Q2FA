import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  decodeFunctionResult,
  encodeFunctionData,
  formatEther,
  formatGwei,
  http,
  toHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arc } from "viem/chains";
import { slh_dsa_sha2_128s } from "@noble/post-quantum/slh-dsa.js";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
loadEnv({ path: resolve(PROJECT_ROOT, ".env") });

const RPC_URL = "https://rpc.mainnet.arc.io";
const EXPECTED_CHAIN_ID = 5042;
const EXPECTED_WALLET_A = "0x90e3a58694e953f5eC4018fF7dd57BE036f11FcE";
const PQ_VERIFIER = "0x1800000000000000000000000000000000000004" as const;
const EXPECTED_VK_BYTES = 32;
const EXPECTED_SIGNATURE_BYTES = 7_856;
const MAX_PHASE0_FEE_WEI = 100_000_000_000_000_000n; // 0.10 USDC at 18 decimals
const MESSAGE_TEXT = `Q2FA_PHASE0_ARC_MAINNET_V1\nchainId=5042\nwalletA=${EXPECTED_WALLET_A}`;
const MESSAGE_BYTES = new TextEncoder().encode(MESSAGE_TEXT);

const verifierAbi = [
  {
    type: "function",
    name: "verifySlhDsaSha2128s",
    stateMutability: "view",
    inputs: [
      { name: "vk", type: "bytes" },
      { name: "message", type: "bytes" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [{ name: "isValid", type: "bool" }],
  },
] as const;

const publicClient = createPublicClient({
  chain: arc,
  transport: http(RPC_URL, { timeout: 30_000 }),
});

type VerificationOutcome = "NOT RUN" | "true" | "false" | `ERROR: ${string}`;

const state = {
  chainId: "NOT CONFIRMED",
  signerAddress: "NOT RESOLVED",
  walletMatch: false,
  balance: "NOT READ",
  baseFee: "NOT READ",
  suggestedGasPrice: "NOT READ",
  publicKeyBytes: "NOT GENERATED",
  signatureBytes: "NOT GENERATED",
  messageHex: "NOT SIGNED",
  localVerify: "NOT RUN",
  validResult: "NOT RUN" as VerificationOutcome,
  tamperedMessageResult: "NOT RUN" as VerificationOutcome,
  corruptedSignatureResult: "NOT RUN" as VerificationOutcome,
  calldataBytes: "NOT BUILT",
  estimatedGas: "NOT ESTIMATED",
  projectedFee: "NOT ESTIMATED",
  maxFeePerGas: "NOT SET",
  maximumFee: "NOT CALCULATED",
  txHash: "NOT BROADCAST",
  broadcastAttempted: false,
  block: "NOT MINED",
  status: "NOT MINED",
  gasUsed: "NOT MINED",
  effectiveGasPrice: "NOT MINED",
  actualFeeWei: "NOT MINED",
  actualFeeUsdc: "NOT MINED",
  finality: "NOT OBSERVED",
  explorerCrossCheck: "NOT CHECKED",
  findings: [] as string[],
  passed: false,
};

class Phase0Stop extends Error {}

function reportMarkdown(): string {
  const runFindings = state.findings.length
    ? state.findings.map((finding) => `- ${finding}`).join("\n")
    : "- No unexpected behavior observed so far.";

  return `# Q2FA Phase 0 — Arc Mainnet PQ Feasibility

## Result
${state.passed ? "PASS" : "FAIL"}

## Network
- Chain ID: ${state.chainId}
- RPC used: ${RPC_URL}
- PQ verifier: ${PQ_VERIFIER}

## Wallet
- Wallet A public address only: ${state.signerAddress}
- Wallet A signer match: ${state.walletMatch ? "PASS" : "FAIL / NOT CONFIRMED"}
- Native Arc balance at check: ${state.balance}
- Current base fee: ${state.baseFee}
- Current suggested gas price: ${state.suggestedGasPrice}

## PQ Compatibility
- Algorithm: SLH-DSA-SHA2-128s (FIPS 205)
- Verifying-key bytes: ${state.publicKeyBytes} (Arc expects ${EXPECTED_VK_BYTES})
- Signature bytes: ${state.signatureBytes} (Arc expects ${EXPECTED_SIGNATURE_BYTES})
- Message format: UTF-8 bytes, no trailing newline: \`${MESSAGE_TEXT.replaceAll("\n", "\\n")}\`
- Exact message bytes (hex): ${state.messageHex}
- Local signature verification: ${state.localVerify}
- ABI calldata bytes: ${state.calldataBytes}

## Verification Results
- Valid signature: ${state.validResult}
- Tampered message: ${state.tamperedMessageResult}
- Corrupted signature: ${state.corruptedSignatureResult}

## Mainnet Transaction
- Transaction hash: ${state.txHash}
- Broadcast attempt consumed: ${state.broadcastAttempted ? "YES" : "NO"}
- Block: ${state.block}
- Status: ${state.status}
- Gas used: ${state.gasUsed}
- Effective gas price: ${state.effectiveGasPrice}
- Actual fee in native units: ${state.actualFeeWei}
- Exact USDC network fee: ${state.actualFeeUsdc}
- Current-price fee projection: ${state.projectedFee}
- Conservative maximum fee ceiling: ${state.maximumFee} (max fee per gas: ${state.maxFeePerGas})
- Observed confirmation/finality behavior: ${state.finality}
- Arc explorer cross-check: ${state.explorerCrossCheck}

## Findings
${runFindings}

## Implications for Q2FA
${state.passed
    ? "The Arc Mainnet PQ verifier accepted a locally generated SLH-DSA-SHA2-128s signature, rejected both tampering cases, and completed one zero-value verification transaction. This supports using the verifier as the PQ factor in a smart-account design, provided the account separately enforces the EVM owner factor and requires both checks before authorizing movement."
    : "The Phase 0 acceptance criteria are not all met. The PQ verifier has not been proven suitable for the planned two-factor account until the failed or unrun criteria are resolved."}

## Phase 1 Recommendation
${state.passed ? "Proceed to architecture design for enforcing both factors in one smart account." : "Resolve the reported Phase 0 blocker before architecture work."}

## References
- [Circle Arc Mainnet connection details](https://docs.arc.io/arc/references/connect-to-arc)
- [Circle Arc gas and fees](https://docs.arc.io/arc/references/gas-and-fees)
- [circlefin/arc-node PQ precompile implementation](https://github.com/circlefin/arc-node/blob/main/crates/pq-precompile/src/lib.rs)
- [circlefin/arc-node PQ precompile integration tests](https://github.com/circlefin/arc-node/blob/main/crates/precompiles/src/pq.rs)
- [noble-post-quantum SLH-DSA documentation](https://github.com/paulmillr/noble-post-quantum)
`;
}

async function saveReport(): Promise<void> {
  await writeFile(resolve(PROJECT_ROOT, "PHASE0_RESULTS.md"), reportMarkdown(), "utf8");
}

async function priorBroadcastAttemptExists(): Promise<boolean> {
  try {
    const priorReport = await readFile(resolve(PROJECT_ROOT, "PHASE0_RESULTS.md"), "utf8");
    return /^- Broadcast attempt consumed: YES$/m.test(priorReport);
  } catch {
    return false;
  }
}

function safeErrorDescription(error: unknown): string {
  let description =
    error instanceof BaseError
      ? error.shortMessage
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : "Unknown error";
  const configuredKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (configuredKey) description = description.replaceAll(configuredKey, "[redacted]");
  return description
    .replace(/0x[0-9a-fA-F]{64,}/g, "[hex payload omitted]")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

function encodeVerifierCall(vk: Uint8Array, message: Uint8Array, signature: Uint8Array): Hex {
  return encodeFunctionData({
    abi: verifierAbi,
    functionName: "verifySlhDsaSha2128s",
    args: [toHex(vk), toHex(message), toHex(signature)],
  });
}

async function ethCallVerifier(
  from: `0x${string}`,
  calldata: Hex,
): Promise<boolean> {
  const response = await publicClient.call({
    account: from,
    to: PQ_VERIFIER,
    data: calldata,
  });
  if (!response.data) throw new Error("eth_call returned no ABI result");
  return decodeFunctionResult({
    abi: verifierAbi,
    functionName: "verifySlhDsaSha2128s",
    data: response.data,
  });
}

async function run(): Promise<void> {
  if (await priorBroadcastAttemptExists()) {
    console.log("A Phase 0 broadcast attempt is already recorded; refusing to send another transaction. Review PHASE0_RESULTS.md.");
    return;
  }
  await saveReport();

  // Gate 1: RPC availability and exact chain ID, before reading the configured signer.
  let chainId: number;
  try {
    chainId = await publicClient.getChainId();
  } catch {
    throw new Phase0Stop("Arc Mainnet RPC did not respond to eth_chainId; stopped before any further action.");
  }
  state.chainId = String(chainId);
  await saveReport();
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Phase0Stop(`RPC chain ID was ${chainId}; expected ${EXPECTED_CHAIN_ID}. Stopped.`);
  }

  // Gate 2: resolve only DEPLOYER_PRIVATE_KEY and compare it to Wallet A.
  const configuredKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!configuredKey || !/^0x[0-9a-fA-F]{64}$/.test(configuredKey)) {
    throw new Phase0Stop("DEPLOYER_PRIVATE_KEY is missing or malformed; its value was suppressed. Stopped.");
  }
  let account;
  try {
    account = privateKeyToAccount(configuredKey as Hex);
  } catch {
    throw new Phase0Stop("DEPLOYER_PRIVATE_KEY could not be resolved; its value was suppressed. Stopped.");
  }
  state.signerAddress = account.address;
  state.walletMatch = account.address.toLowerCase() === EXPECTED_WALLET_A.toLowerCase();
  await saveReport();
  if (!state.walletMatch) {
    throw new Phase0Stop(
      `Configured signer resolved to ${account.address}; expected Wallet A ${EXPECTED_WALLET_A}. Stopped before balance queries or any transaction.`,
    );
  }

  // Read and print only the public Wallet A address, native balance, and fee data.
  const [balance, latestBlock, currentGasPrice] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.getBlock({ blockTag: "latest" }),
    publicClient.getGasPrice(),
  ]);
  state.balance = `${formatEther(balance)} USDC (native 18-decimal units)`;
  state.baseFee = latestBlock.baseFeePerGas === null
    ? "not exposed in latest block"
    : `${formatGwei(latestBlock.baseFeePerGas)} gwei (${latestBlock.baseFeePerGas} wei)`;
  state.suggestedGasPrice = `${formatGwei(currentGasPrice)} gwei (${currentGasPrice} wei)`;
  console.log(`Wallet A public address: ${account.address}`);
  console.log(`Native Arc balance: ${state.balance}`);
  console.log(`Current base fee: ${state.baseFee}`);
  console.log(`Current suggested gas price: ${state.suggestedGasPrice}`);
  await saveReport();

  // Create and use the disposable SLH-DSA key entirely in memory.
  const keyPair = slh_dsa_sha2_128s.keygen();
  const ephemeralSecretKey = keyPair.secretKey;
  const verifyingKey = keyPair.publicKey;
  state.publicKeyBytes = String(verifyingKey.length);
  if (verifyingKey.length !== EXPECTED_VK_BYTES) {
    ephemeralSecretKey.fill(0);
    throw new Phase0Stop(
      `Generated verifying key was ${verifyingKey.length} bytes; Arc expects ${EXPECTED_VK_BYTES}. Stopped before any Arc verifier call.`,
    );
  }

  let signature: Uint8Array;
  try {
    signature = slh_dsa_sha2_128s.sign(MESSAGE_BYTES, ephemeralSecretKey);
  } finally {
    ephemeralSecretKey.fill(0);
  }
  state.signatureBytes = String(signature.length);
  state.messageHex = toHex(MESSAGE_BYTES);
  if (signature.length !== EXPECTED_SIGNATURE_BYTES) {
    throw new Phase0Stop(
      `Generated signature was ${signature.length} bytes; Arc expects ${EXPECTED_SIGNATURE_BYTES}. Stopped before any Arc verifier call.`,
    );
  }
  const localSignatureValid = slh_dsa_sha2_128s.verify(signature, MESSAGE_BYTES, verifyingKey);
  state.localVerify = localSignatureValid ? "PASS" : "FAIL";
  if (!localSignatureValid) throw new Phase0Stop("The locally generated signature did not verify locally; stopped.");
  await saveReport();
  console.log(`PQ verifying-key bytes: ${verifyingKey.length}`);
  console.log(`PQ signature bytes: ${signature.length}`);

  const validCalldata = encodeVerifierCall(verifyingKey, MESSAGE_BYTES, signature);
  state.calldataBytes = String((validCalldata.length - 2) / 2);

  // Read-only valid signature check. Any non-true outcome stops before negatives, estimate, or broadcast.
  try {
    const validResult = await ethCallVerifier(account.address, validCalldata);
    state.validResult = String(validResult) as VerificationOutcome;
  } catch (error) {
    state.validResult = `ERROR: ${safeErrorDescription(error)}`;
    await saveReport();
    throw new Phase0Stop(`Valid signature eth_call failed: ${safeErrorDescription(error)}. No transaction was broadcast.`);
  }
  await saveReport();
  console.log(`Valid signature eth_call: ${state.validResult}`);
  if (state.validResult !== "true") {
    throw new Phase0Stop("Valid signature did not return true from Arc Mainnet eth_call. No transaction was broadcast.");
  }

  // Negative A: flip one byte of the message, holding key and signature fixed.
  const tamperedMessage = MESSAGE_BYTES.slice();
  tamperedMessage[tamperedMessage.length - 1] ^= 0x01;
  try {
    const result = await ethCallVerifier(
      account.address,
      encodeVerifierCall(verifyingKey, tamperedMessage, signature),
    );
    state.tamperedMessageResult = String(result) as VerificationOutcome;
  } catch (error) {
    state.tamperedMessageResult = `ERROR: ${safeErrorDescription(error)}`;
    await saveReport();
    throw new Phase0Stop(`Tampered-message eth_call did not return a boolean: ${safeErrorDescription(error)}. Stopped before estimate or broadcast.`);
  }
  await saveReport();
  console.log(`Tampered-message eth_call: ${state.tamperedMessageResult}`);
  if (state.tamperedMessageResult !== "false") {
    throw new Phase0Stop("Tampered message was not rejected with false. Stopped before estimate or broadcast.");
  }

  // Negative B: flip one byte of the signature, holding key and message fixed.
  const corruptedSignature = signature.slice();
  corruptedSignature[0] ^= 0x01;
  try {
    const result = await ethCallVerifier(
      account.address,
      encodeVerifierCall(verifyingKey, MESSAGE_BYTES, corruptedSignature),
    );
    state.corruptedSignatureResult = String(result) as VerificationOutcome;
  } catch (error) {
    state.corruptedSignatureResult = `ERROR: ${safeErrorDescription(error)}`;
    await saveReport();
    throw new Phase0Stop(`Corrupted-signature eth_call did not return a boolean: ${safeErrorDescription(error)}. Stopped before estimate or broadcast.`);
  }
  await saveReport();
  console.log(`Corrupted-signature eth_call: ${state.corruptedSignatureResult}`);
  if (state.corruptedSignatureResult !== "false") {
    throw new Phase0Stop("Corrupted signature was not rejected with false. Stopped before estimate or broadcast.");
  }

  // All read-only calls behaved correctly. Estimate the valid verification transaction.
  const freshBlock = await publicClient.getBlock({ blockTag: "latest" });
  const freshGasPrice = await publicClient.getGasPrice();
  const estimatedGas = await publicClient.estimateGas({
    account: account.address,
    to: PQ_VERIFIER,
    data: validCalldata,
    value: 0n,
  });
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;
  const maxFeePerGas = freshGasPrice * 2n;
  const projectedFeeWei = estimatedGas * freshGasPrice;
  const maximumFeeWei = gasLimit * maxFeePerGas;
  state.estimatedGas = `${estimatedGas} gas (transaction gas limit ${gasLimit} gas)`;
  state.projectedFee = `${formatEther(projectedFeeWei)} USDC at suggested ${formatGwei(freshGasPrice)} gwei`;
  state.maxFeePerGas = `${formatGwei(maxFeePerGas)} gwei (${maxFeePerGas} wei)`;
  state.maximumFee = `${formatEther(maximumFeeWei)} USDC (${maximumFeeWei} wei)`;
  state.baseFee = freshBlock.baseFeePerGas === null
    ? "not exposed in latest block"
    : `${formatGwei(freshBlock.baseFeePerGas)} gwei (${freshBlock.baseFeePerGas} wei)`;
  state.suggestedGasPrice = `${formatGwei(freshGasPrice)} gwei (${freshGasPrice} wei)`;
  await saveReport();

  console.log(`Valid verification estimated gas: ${estimatedGas}`);
  console.log(`Projected fee at current suggested price: ${state.projectedFee}`);
  console.log(`Conservative maximum fee ceiling: ${state.maximumFee}`);
  if (maximumFeeWei >= MAX_PHASE0_FEE_WEI) {
    throw new Phase0Stop(
      `The conservative maximum fee ceiling is ${formatEther(maximumFeeWei)} USDC, which is not below the 0.10 USDC Phase 0 limit. Stopped before broadcast for review.`,
    );
  }

  // Exactly one zero-value transaction, and only after every read-only gate passed.
  const walletClient = createWalletClient({
    account,
    chain: arc,
    transport: http(RPC_URL, { timeout: 30_000 }),
  });
  state.broadcastAttempted = true;
  await saveReport();
  const sentAt = Date.now();
  const hash = await walletClient.sendTransaction({
    account,
    chain: arc,
    to: PQ_VERIFIER,
    data: validCalldata,
    value: 0n,
    gas: gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas: 0n,
  });
  state.txHash = hash;
  await saveReport();
  console.log(`Broadcast one zero-value mainnet verification transaction: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 120_000,
    pollingInterval: 1_000,
  });
  const receiptBlock = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  let latestHeight = await publicClient.getBlockNumber();
  for (let retry = 0; latestHeight < receipt.blockNumber && retry < 10; retry += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    latestHeight = await publicClient.getBlockNumber();
  }
  const effectiveGasPrice = receipt.effectiveGasPrice;
  const actualFeeWei = receipt.gasUsed * effectiveGasPrice;
  state.block = `${receipt.blockNumber} (0x${receipt.blockNumber.toString(16)})`;
  state.status = receipt.status;
  state.gasUsed = `${receipt.gasUsed}`;
  state.effectiveGasPrice = `${formatGwei(effectiveGasPrice)} gwei (${effectiveGasPrice} wei)`;
  state.actualFeeWei = `${actualFeeWei} wei`;
  state.actualFeeUsdc = `${formatEther(actualFeeWei)} USDC (native USDC accounting, 18 decimals)`;
  const observedConfirmations = latestHeight >= receipt.blockNumber
    ? latestHeight - receipt.blockNumber + 1n
    : 0n;
  state.finality = `Receipt returned ${Date.now() - sentAt} ms after broadcast at block ${receipt.blockNumber}; queried that block successfully (hash ${receiptBlock.hash}); latest observed height ${latestHeight} (${observedConfirmations} blocks including the receipt). Arc documents deterministic finality with no reorgs, so no extra confirmation depth was required.`;
  await saveReport();

  console.log(`Receipt status: ${receipt.status}`);
  console.log(`Gas used: ${receipt.gasUsed}`);
  console.log(`Effective gas price: ${state.effectiveGasPrice}`);
  console.log(`Exact network fee: ${state.actualFeeUsdc}`);

  if (receipt.status !== "success") {
    throw new Phase0Stop("The single verification transaction was mined with a non-success status.");
  }
  if (actualFeeWei >= MAX_PHASE0_FEE_WEI) {
    throw new Phase0Stop(
      `Actual fee ${formatEther(actualFeeWei)} USDC reached or exceeded the strict 0.10 USDC Phase 0 spend ceiling.`,
    );
  }
  state.passed = true;
  state.findings.push(
    "Circle's Arc node source exposes the verifier at the expected precompile and confirms malformed lengths revert while validly encoded incorrect signatures return false.",
    "The one broadcast call used value 0; the observed network fee was the only intentional Phase 0 spend.",
    "The EVM private key was read only from DEPLOYER_PRIVATE_KEY; neither private key was printed, persisted, or sent to Arc. The disposable PQ secret buffer was zeroed after signing.",
  );
  await saveReport();
}

run().catch(async (error: unknown) => {
  const message = error instanceof Phase0Stop ? error.message : safeErrorDescription(error);
  if (!(error instanceof Phase0Stop)) state.findings.push(`Unexpected failure: ${message}`);
  else state.findings.push(message);
  await saveReport();
  console.error(`Phase 0 stopped: ${message}`);
  process.exitCode = 1;
});
