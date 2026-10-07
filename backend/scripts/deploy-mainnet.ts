import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  formatUnits,
  hexToBytes,
  http,
  parseAbi,
  parseUnits,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { slh_dsa_sha2_128s } from "@noble/post-quantum/slh-dsa.js";
import {
  ARC_CHAIN_ID,
  ARC_RPC_URL,
  ARC_USDC,
  PQ_PUBLIC_KEY_BYTES,
  PQ_SIGNATURE_BYTES,
  WALLET_A,
  addressSubject,
  arcMainnet,
  encodeAuthorizationPayload,
  AuthorizationAction,
} from "@q2fa/shared";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ENV_PATH = resolve(PROJECT_ROOT, ".env");
const ARTIFACT_PATH = resolve(PROJECT_ROOT, "contracts/artifacts/src/Q2FAAccount.sol/Q2FAAccount.json");
const DEV_GUARDIAN_ENV = "Q2FA_PHASE1_DEV_GUARDIAN_SEED";
const PROBE_AMOUNT = 1n; // One ERC-20 base unit, or 0.000001 USDC.
const MAX_PHASE1_FEES = parseUnits("0.10", 18);
const ONE_GWEI = parseUnits("1", 9);

class SafeFailure extends Error {}

loadEnv({ path: ENV_PATH, quiet: true });

const publicClient = createPublicClient({ chain: arcMainnet, transport: http(ARC_RPC_URL) });
const q2faAbi = parseAbi([
  "function owner() view returns (address)",
  "function guardianKey() view returns (bytes32)",
  "function nonce() view returns (uint256)",
  "function withdraw(address recipient, uint256 amount, uint256 deadline, bytes pqSignature)",
]);
const usdcAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address recipient, uint256 amount) returns (bool)",
]);

interface FeeSnapshot {
  expectedGasPrice: bigint;
  maxFeePerGas: bigint;
  baseFeePerGas: bigint;
}

interface AccountArtifact {
  abi: Abi;
  bytecode: string | { object: string };
}

function feeFor(gas: bigint, price: bigint): bigint {
  return gas * price;
}

function formattedFee(amount: bigint): string {
  return `${formatUnits(amount, 18)} USDC`;
}

async function getFeeSnapshot(): Promise<FeeSnapshot> {
  const [block, suggestedGasPrice] = await Promise.all([
    publicClient.getBlock({ blockTag: "latest" }),
    publicClient.getGasPrice(),
  ]);
  const baseFeePerGas = block.baseFeePerGas ?? suggestedGasPrice;
  const expectedGasPrice = suggestedGasPrice > baseFeePerGas ? suggestedGasPrice : baseFeePerGas;
  return {
    expectedGasPrice,
    maxFeePerGas: expectedGasPrice + ONE_GWEI,
    baseFeePerGas,
  };
}

function assertProjectedSpend(actualFees: bigint, projectedFee: bigint, action: string): void {
  if (actualFees + projectedFee > MAX_PHASE1_FEES) {
    throw new SafeFailure(
      `${action} projected fees would exceed the Phase 1 $0.10 USDC budget; transaction was not broadcast.`,
    );
  }
}

async function assertBalanceForFee(address: Address, maximumFee: bigint, action: string): Promise<void> {
  const currentBalance = await publicClient.getBalance({ address });
  if (currentBalance < maximumFee) {
    throw new SafeFailure(`${action} maximum fee exceeds Wallet A's current native USDC balance; transaction was not broadcast.`);
  }
}

function loadOrCreateGuardianSeed(): Uint8Array {
  const existing = process.env[DEV_GUARDIAN_ENV];
  if (existing && existing.trim().length > 0) {
    const normalized = existing.startsWith("0x") ? existing.slice(2) : existing;
    if (!/^[0-9a-fA-F]{96}$/.test(normalized)) {
      throw new SafeFailure("The local Phase 1 guardian seed has an invalid format; no transaction was broadcast.");
    }
    return hexToBytes(`0x${normalized}`);
  }

  const seed = randomBytes(slh_dsa_sha2_128s.lengths.seed!);
  if (seed.length !== 48) throw new SafeFailure("Unexpected SLH-DSA seed length.");

  const line = `${DEV_GUARDIAN_ENV}=${toHex(seed)}`;
  let envText = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const keyLine = new RegExp(`^${DEV_GUARDIAN_ENV}=.*$`, "m");
  if (keyLine.test(envText)) {
    envText = envText.replace(keyLine, line);
    writeFileSync(ENV_PATH, envText, "utf8");
  } else {
    if (envText.length > 0 && !envText.endsWith("\n")) appendFileSync(ENV_PATH, "\n", "utf8");
    appendFileSync(ENV_PATH, `${line}\n`, "utf8");
  }
  process.env[DEV_GUARDIAN_ENV] = toHex(seed);
  return Uint8Array.from(seed);
}

async function recordReceipt(
  label: string,
  hash: Hex,
  receipt: TransactionReceipt,
  fallbackGasPrice: bigint,
  startedAt: number,
): Promise<bigint> {
  const gasPrice = receipt.effectiveGasPrice ?? fallbackGasPrice;
  const actualFee = feeFor(receipt.gasUsed, gasPrice);
  console.log(`${label} transaction hash: ${hash}`);
  console.log(`${label} receipt: block ${receipt.blockNumber}, status ${receipt.status}`);
  console.log(`${label} gas used: ${receipt.gasUsed.toString()}`);
  console.log(`${label} effective gas price: ${gasPrice.toString()} wei/gas`);
  console.log(`${label} exact network fee: ${actualFee.toString()} native units (${formattedFee(actualFee)})`);
  console.log(`${label} receipt wait: ${((performance.now() - startedAt) / 1_000).toFixed(3)} seconds`);
  return actualFee;
}

async function assertMainnetAndSigner(signerAddress: Address): Promise<void> {
  const chainId = await publicClient.getChainId();
  if (chainId !== ARC_CHAIN_ID) {
    throw new SafeFailure(`RPC chain ID is ${chainId}; expected Arc Mainnet ${ARC_CHAIN_ID}.`);
  }
  if (signerAddress.toLowerCase() !== WALLET_A.toLowerCase()) {
    throw new SafeFailure("Configured signer does not resolve to Wallet A; no transaction was broadcast.");
  }
}

async function main(): Promise<void> {
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey || !/^0x[0-9a-fA-F]{64}$/.test(deployerKey)) {
    throw new SafeFailure("DEPLOYER_PRIVATE_KEY must be a 32-byte hex value in the local environment.");
  }

  const signer = privateKeyToAccount(deployerKey as Hex);
  await assertMainnetAndSigner(signer.address);

  const [nativeBalance, usdcCode, usdcDecimals, walletUsdcBalance, initialFees] = await Promise.all([
    publicClient.getBalance({ address: signer.address }),
    publicClient.getBytecode({ address: ARC_USDC }),
    publicClient.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "decimals" }),
    publicClient.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [signer.address] }),
    getFeeSnapshot(),
  ]);
  if (!usdcCode || usdcCode === "0x") throw new SafeFailure("Arc Mainnet USDC interface has no code at the documented address.");
  if (usdcDecimals !== 6) throw new SafeFailure(`Arc Mainnet USDC ERC-20 decimals are ${usdcDecimals}, not 6.`);
  if (walletUsdcBalance < PROBE_AMOUNT) throw new SafeFailure("Wallet A lacks the one-unit USDC balance needed for the protected-action check.");

  console.log(`Arc Mainnet chain ID: ${ARC_CHAIN_ID}`);
  console.log(`Wallet A public address: ${signer.address}`);
  console.log(`Wallet A native USDC gas balance: ${formatUnits(nativeBalance, 18)} USDC`);
  console.log(`Wallet A ERC-20 USDC balance: ${formatUnits(walletUsdcBalance, 6)} USDC (same underlying balance; not additive)`);
  console.log(`USDC ERC-20 decimals: ${usdcDecimals}`);
  console.log(`Current base fee: ${initialFees.baseFeePerGas.toString()} wei/gas`);
  console.log(`Suggested gas price: ${initialFees.expectedGasPrice.toString()} wei/gas`);

  const seed = loadOrCreateGuardianSeed();
  const keyPair = slh_dsa_sha2_128s.keygen(seed);
  seed.fill(0);
  const publicKey = keyPair.publicKey;
  const secretKey = keyPair.secretKey;
  if (publicKey.length !== PQ_PUBLIC_KEY_BYTES || secretKey.length !== 64) {
    secretKey.fill(0);
    throw new SafeFailure("Generated SLH-DSA key sizes do not match the configured Arc profile.");
  }
  const publicKeyHex = toHex(publicKey) as Hex;
  console.log(`Development guardian public key: ${publicKeyHex}`);

  let actualFees = 0n;
  let signature: Uint8Array | undefined;
  try {
    const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as AccountArtifact;
    const bytecode = typeof artifact.bytecode === "string" ? artifact.bytecode : artifact.bytecode.object;
    if (!bytecode || bytecode === "0x") throw new SafeFailure("Q2FAAccount build artifact is missing bytecode.");
    const constructorArgs = [WALLET_A, publicKeyHex] as const;
    const deploymentData = encodeDeployData({ abi: artifact.abi, bytecode: bytecode as Hex, args: constructorArgs });

    await assertMainnetAndSigner(signer.address);
    const deployFees = await getFeeSnapshot();
    const deploymentGas = await publicClient.estimateGas({
      account: signer.address,
      data: deploymentData,
      maxFeePerGas: deployFees.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
    });
    await publicClient.call({
      account: signer.address,
      data: deploymentData,
      gas: deploymentGas,
      maxFeePerGas: deployFees.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
    });
    const deploymentFeeEstimate = feeFor(deploymentGas, deployFees.expectedGasPrice);
    const deploymentFeeMaximum = feeFor(deploymentGas, deployFees.maxFeePerGas);
    assertProjectedSpend(actualFees, deploymentFeeMaximum, "Q2FA account deployment");
    if (nativeBalance < deploymentFeeMaximum) throw new SafeFailure("Wallet A native USDC balance is below the deployment maximum fee.");

    console.log(`Deployment target: contract creation from ${signer.address}`);
    console.log(`Deployment calldata bytes: ${((deploymentData.length - 2) / 2).toString()}`);
    console.log(`Deployment gas estimate: ${deploymentGas.toString()}`);
    console.log(`Projected deployment fee: ${formattedFee(deploymentFeeEstimate)}`);
    console.log(`Maximum deployment fee at transaction maxFeePerGas: ${formattedFee(deploymentFeeMaximum)}`);

    await assertMainnetAndSigner(signer.address);
    await assertBalanceForFee(signer.address, deploymentFeeMaximum, "Q2FA account deployment");
    const deploymentStarted = performance.now();
    const deploymentHash = await createWalletClient({ account: signer, chain: arcMainnet, transport: http(ARC_RPC_URL) })
      .sendTransaction({
        account: signer,
        data: deploymentData,
        value: 0n,
        gas: deploymentGas,
        maxFeePerGas: deployFees.maxFeePerGas,
        maxPriorityFeePerGas: 0n,
      });
    console.log(`Deployment submitted: ${deploymentHash}`);
    const deploymentReceipt = await publicClient.waitForTransactionReceipt({ hash: deploymentHash, timeout: 120_000 });
    actualFees += await recordReceipt("Deployment", deploymentHash, deploymentReceipt, deployFees.expectedGasPrice, deploymentStarted);
    if (deploymentReceipt.status !== "success" || !deploymentReceipt.contractAddress) {
      throw new SafeFailure("The Q2FA account deployment did not produce a successful contract receipt.");
    }
    const q2faAddress = deploymentReceipt.contractAddress;
    console.log(`Q2FA account address: ${q2faAddress}`);

    await assertMainnetAndSigner(signer.address);
    const [deployedCode, deployedOwner, deployedGuardian, deployedNonce] = await Promise.all([
      publicClient.getBytecode({ address: q2faAddress }),
      publicClient.readContract({ address: q2faAddress, abi: q2faAbi, functionName: "owner" }),
      publicClient.readContract({ address: q2faAddress, abi: q2faAbi, functionName: "guardianKey" }),
      publicClient.readContract({ address: q2faAddress, abi: q2faAbi, functionName: "nonce" }),
    ]);
    if (!deployedCode || deployedCode === "0x") throw new SafeFailure("Deployed Q2FA address has no runtime code.");
    if (deployedOwner.toLowerCase() !== WALLET_A.toLowerCase()) throw new SafeFailure("Deployed owner does not match Wallet A.");
    if (deployedGuardian.toLowerCase() !== publicKeyHex.toLowerCase()) throw new SafeFailure("Deployed guardian does not match the generated development key.");
    if (deployedNonce !== 0n) throw new SafeFailure("New Q2FA account nonce is not zero.");
    console.log(`Deployed state verified: owner ${deployedOwner}, guardian ${deployedGuardian}, nonce ${deployedNonce}`);

    const depositData = encodeFunctionData({
      abi: usdcAbi,
      functionName: "transfer",
      args: [q2faAddress, PROBE_AMOUNT],
    });
    await assertMainnetAndSigner(signer.address);
    const depositSimulation = await publicClient.simulateContract({
      account: signer.address,
      address: ARC_USDC,
      abi: usdcAbi,
      functionName: "transfer",
      args: [q2faAddress, PROBE_AMOUNT],
    });
    if (depositSimulation.result !== true) throw new SafeFailure("The one-unit USDC deposit simulation returned false.");
    const depositFees = await getFeeSnapshot();
    const depositGas = await publicClient.estimateContractGas({
      account: signer.address,
      address: ARC_USDC,
      abi: usdcAbi,
      functionName: "transfer",
      args: [q2faAddress, PROBE_AMOUNT],
      maxFeePerGas: depositFees.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
    });
    const depositFeeEstimate = feeFor(depositGas, depositFees.expectedGasPrice);
    const depositFeeMaximum = feeFor(depositGas, depositFees.maxFeePerGas);
    assertProjectedSpend(actualFees, depositFeeMaximum, "One-unit USDC deposit");
    await assertBalanceForFee(signer.address, depositFeeMaximum, "One-unit USDC deposit");
    console.log(`Deposit target: ${ARC_USDC}`);
    console.log(`Deposit calldata bytes: ${((depositData.length - 2) / 2).toString()}`);
    console.log(`Deposit amount: ${PROBE_AMOUNT.toString()} ERC-20 base unit (0.000001 USDC); transaction value 0`);
    console.log(`Deposit gas estimate: ${depositGas.toString()}`);
    console.log(`Projected deposit fee: ${formattedFee(depositFeeEstimate)}`);
    console.log(`Maximum deposit fee at transaction maxFeePerGas: ${formattedFee(depositFeeMaximum)}`);

    await assertMainnetAndSigner(signer.address);
    await assertBalanceForFee(signer.address, depositFeeMaximum, "One-unit USDC deposit");
    const depositStarted = performance.now();
    const walletClient = createWalletClient({ account: signer, chain: arcMainnet, transport: http(ARC_RPC_URL) });
    const depositHash = await walletClient.writeContract({
      account: signer,
      address: ARC_USDC,
      abi: usdcAbi,
      functionName: "transfer",
      args: [q2faAddress, PROBE_AMOUNT],
      gas: depositGas,
      maxFeePerGas: depositFees.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
    });
    console.log(`Deposit submitted: ${depositHash}`);
    const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash, timeout: 120_000 });
    actualFees += await recordReceipt("One-unit USDC deposit", depositHash, depositReceipt, depositFees.expectedGasPrice, depositStarted);
    if (depositReceipt.status !== "success") throw new SafeFailure("The one-unit USDC deposit transaction reverted.");

    const [accountUsdcBalance, currentNonce, latestBlock] = await Promise.all([
      publicClient.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [q2faAddress] }),
      publicClient.readContract({ address: q2faAddress, abi: q2faAbi, functionName: "nonce" }),
      publicClient.getBlock({ blockTag: "latest" }),
    ]);
    if (accountUsdcBalance < PROBE_AMOUNT) throw new SafeFailure("The Q2FA account did not receive the one-unit USDC deposit.");

    const deadline = latestBlock.timestamp + 3_600n;
    const payload = encodeAuthorizationPayload({
      chainId: ARC_CHAIN_ID,
      account: q2faAddress,
      action: AuthorizationAction.Withdraw,
      subject: addressSubject(WALLET_A),
      amount: PROBE_AMOUNT,
      nonce: currentNonce,
      deadline,
    });
    const message = hexToBytes(payload);
    signature = slh_dsa_sha2_128s.sign(message, secretKey);
    if (signature.length !== PQ_SIGNATURE_BYTES) throw new SafeFailure("Generated PQ signature size does not match Arc's verifier.");
    if (!slh_dsa_sha2_128s.verify(signature, message, publicKey)) throw new SafeFailure("Local SLH-DSA signature self-check failed.");
    const signatureHex = toHex(signature) as Hex;

    const withdrawalData = encodeFunctionData({
      abi: q2faAbi,
      functionName: "withdraw",
      args: [WALLET_A, PROBE_AMOUNT, deadline, signatureHex],
    });
    await assertMainnetAndSigner(signer.address);
    const withdrawalSimulation = await publicClient.simulateContract({
      account: signer.address,
      address: q2faAddress,
      abi: q2faAbi,
      functionName: "withdraw",
      args: [WALLET_A, PROBE_AMOUNT, deadline, signatureHex],
    });
    void withdrawalSimulation;
    const withdrawalFees = await getFeeSnapshot();
    const withdrawalGas = await publicClient.estimateContractGas({
      account: signer.address,
      address: q2faAddress,
      abi: q2faAbi,
      functionName: "withdraw",
      args: [WALLET_A, PROBE_AMOUNT, deadline, signatureHex],
      maxFeePerGas: withdrawalFees.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
    });
    const withdrawalFeeEstimate = feeFor(withdrawalGas, withdrawalFees.expectedGasPrice);
    const withdrawalFeeMaximum = feeFor(withdrawalGas, withdrawalFees.maxFeePerGas);
    assertProjectedSpend(actualFees, withdrawalFeeMaximum, "PQ-protected withdrawal");
    await assertBalanceForFee(signer.address, withdrawalFeeMaximum, "PQ-protected withdrawal");
    console.log(`Withdrawal target: ${q2faAddress}; recipient: Wallet A ${WALLET_A}`);
    console.log(`Withdrawal calldata bytes: ${((withdrawalData.length - 2) / 2).toString()}`);
    console.log(`Withdrawal amount: ${PROBE_AMOUNT.toString()} ERC-20 base unit (0.000001 USDC); transaction value 0`);
    console.log(`Withdrawal gas estimate: ${withdrawalGas.toString()}`);
    console.log(`Projected withdrawal fee: ${formattedFee(withdrawalFeeEstimate)}`);
    console.log(`Maximum withdrawal fee at transaction maxFeePerGas: ${formattedFee(withdrawalFeeMaximum)}`);

    await assertMainnetAndSigner(signer.address);
    await assertBalanceForFee(signer.address, withdrawalFeeMaximum, "PQ-protected withdrawal");
    const withdrawalStarted = performance.now();
    const withdrawalHash = await walletClient.writeContract({
      account: signer,
      address: q2faAddress,
      abi: q2faAbi,
      functionName: "withdraw",
      args: [WALLET_A, PROBE_AMOUNT, deadline, signatureHex],
      gas: withdrawalGas,
      maxFeePerGas: withdrawalFees.maxFeePerGas,
      maxPriorityFeePerGas: 0n,
    });
    console.log(`Withdrawal submitted: ${withdrawalHash}`);
    const withdrawalReceipt = await publicClient.waitForTransactionReceipt({ hash: withdrawalHash, timeout: 120_000 });
    actualFees += await recordReceipt("PQ-protected withdrawal", withdrawalHash, withdrawalReceipt, withdrawalFees.expectedGasPrice, withdrawalStarted);
    if (withdrawalReceipt.status !== "success") throw new SafeFailure("The PQ-protected withdrawal transaction reverted.");

    const [finalNonce, finalAccountBalance, finalOwner] = await Promise.all([
      publicClient.readContract({ address: q2faAddress, abi: q2faAbi, functionName: "nonce" }),
      publicClient.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [q2faAddress] }),
      publicClient.readContract({ address: q2faAddress, abi: q2faAbi, functionName: "owner" }),
    ]);
    if (finalNonce !== currentNonce + 1n || finalAccountBalance !== 0n || finalOwner.toLowerCase() !== WALLET_A.toLowerCase()) {
      throw new SafeFailure("Post-withdrawal state verification did not match the expected nonce, balance, and owner.");
    }
    console.log(`Post-withdrawal state verified: owner ${finalOwner}, nonce ${finalNonce}, account ERC-20 balance ${finalAccountBalance}`);
    console.log(`Total Phase 1 Mainnet network fees: ${actualFees.toString()} native units (${formattedFee(actualFees)})`);
  } finally {
    secretKey.fill(0);
    signature?.fill(0);
    publicKey.fill(0);
  }
}

main().catch((error: unknown) => {
  if (error instanceof SafeFailure) {
    console.error(`Phase 1 Mainnet operation stopped: ${error.message}`);
  } else {
    console.error("Phase 1 Mainnet operation stopped on an RPC, signing, or contract error. Sensitive values were not printed.");
  }
  process.exitCode = 1;
});
