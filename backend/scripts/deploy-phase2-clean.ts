import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { slh_dsa_sha2_128s } from "@noble/post-quantum/slh-dsa.js";
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ARC_CHAIN_ID,
  ARC_RPC_URL,
  WALLET_A,
  arcMainnet,
} from "@q2fa/shared";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = resolve(projectRoot, ".env");
const artifactPath = resolve(projectRoot, "contracts/artifacts/src/Q2FAAccount.sol/Q2FAAccount.json");
const guardianSeedPath = "C:\\Users\\uk\\Documents\\Codex\\.secrets\\Q2FA\\phase2-clean\\guardian-seed.hex";
const phase2FeeCap = parseUnits("0.05", 18);
const laterActionGasReserve = 600_000n;
const oneGwei = parseUnits("1", 9);

loadEnv({ path: envPath, quiet: true });

const publicClient = createPublicClient({ chain: arcMainnet, transport: http(ARC_RPC_URL) });
const q2faAbi = parseAbi([
  "function owner() view returns (address)",
  "function guardianKey() view returns (bytes32)",
  "function nonce() view returns (uint256)",
]);

interface DeploymentArtifact {
  abi: Abi;
  bytecode: string | { object: string };
}

class SafeFailure extends Error {}

function requireArcAndWalletA(signerAddress: Address, chainId: number): void {
  if (chainId !== ARC_CHAIN_ID) throw new SafeFailure(`RPC chain ID was ${chainId}; expected Arc Mainnet ${ARC_CHAIN_ID}.`);
  if (signerAddress.toLowerCase() !== WALLET_A.toLowerCase()) {
    throw new SafeFailure("DEPLOYER_PRIVATE_KEY does not resolve to Wallet A. No transaction was sent.");
  }
}

async function main(): Promise<void> {
  let deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey || !/^0x[0-9a-fA-F]{64}$/.test(deployerKey)) {
    throw new SafeFailure("DEPLOYER_PRIVATE_KEY must be configured locally. No transaction was sent.");
  }
  const signer = privateKeyToAccount(deployerKey as Hex);
  deployerKey = "";
  process.env.DEPLOYER_PRIVATE_KEY = "";

  const initialChainId = await publicClient.getChainId();
  requireArcAndWalletA(signer.address, initialChainId);

  let seedHex = "";
  let seed: Uint8Array | undefined;
  let guardianSecret: Uint8Array | undefined;
  let guardianPublic: Uint8Array | undefined;
  try {
    const savedSeedFile = readFileSync(guardianSeedPath);
    try {
      seedHex = savedSeedFile.toString("utf8").trim();
    } finally {
      savedSeedFile.fill(0);
    }
    if (!/^[0-9a-fA-F]{96}$/.test(seedHex)) throw new SafeFailure("The approved local guardian backup is missing or malformed.");
    seed = Uint8Array.from(Buffer.from(seedHex, "hex"));
    const pair = slh_dsa_sha2_128s.keygen(seed);
    guardianSecret = pair.secretKey;
    guardianPublic = pair.publicKey;
    seed.fill(0);
    seed = undefined;
    seedHex = "";
    if (guardianPublic.length !== 32 || guardianSecret.length !== 64) {
      throw new SafeFailure("The restored guardian does not have the Arc SLH-DSA-SHA2-128s key sizes.");
    }
    const guardianKey = toHex(guardianPublic) as Hex;
    if (guardianKey.toLowerCase() === "0xcb95353dfb1a6daf602f242d2509a24d4bfecae71d59ef246327365c7d8758a1" ||
        guardianKey.toLowerCase() === "0xd4c91a2dde2aa8939a1c86648253489e07841a28d32a337eb98335483ee4b67d") {
      throw new SafeFailure("The generated guardian matches a known development guardian; refusing deployment.");
    }

    const [nativeBalance, block, suggestedGasPrice] = await Promise.all([
      publicClient.getBalance({ address: WALLET_A }),
      publicClient.getBlock({ blockTag: "latest" }),
      publicClient.getGasPrice(),
    ]);
    const baseFeePerGas = block.baseFeePerGas ?? suggestedGasPrice;
    const expectedGasPrice = suggestedGasPrice > baseFeePerGas ? suggestedGasPrice : baseFeePerGas;
    const maxFeePerGas = expectedGasPrice + oneGwei;

    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as DeploymentArtifact;
    const rawBytecode = typeof artifact.bytecode === "string" ? artifact.bytecode : artifact.bytecode.object;
    if (!rawBytecode || rawBytecode === "0x") throw new SafeFailure("The Q2FAAccount deployment artifact has no bytecode.");
    const deploymentData = encodeDeployData({
      abi: artifact.abi,
      bytecode: rawBytecode as Hex,
      args: [WALLET_A, guardianKey],
    });

    requireArcAndWalletA(signer.address, await publicClient.getChainId());
    const deploymentGas = await publicClient.estimateGas({
      account: signer.address,
      data: deploymentData,
      value: 0n,
      maxFeePerGas,
      maxPriorityFeePerGas: 0n,
    });
    await publicClient.call({
      account: signer.address,
      data: deploymentData,
      gas: deploymentGas,
      value: 0n,
      maxFeePerGas,
      maxPriorityFeePerGas: 0n,
    });

    const deploymentFeeEstimate = deploymentGas * expectedGasPrice;
    const deploymentFeeMaximum = deploymentGas * maxFeePerGas;
    const reservedLaterFees = laterActionGasReserve * maxFeePerGas;
    const projectedPhase2Maximum = deploymentFeeMaximum + reservedLaterFees;
    if (projectedPhase2Maximum >= phase2FeeCap) {
      throw new SafeFailure("Deployment plus reserved deposit/withdrawal fees would reach the 0.05 USDC Phase 2 cap. No transaction was sent.");
    }
    if (nativeBalance < projectedPhase2Maximum) {
      throw new SafeFailure("Wallet A's native USDC balance is below the deployment plus reserved-action fee budget. No transaction was sent.");
    }

    console.log(`Arc Mainnet chain ID: ${initialChainId}`);
    console.log(`Wallet A public address: ${signer.address}`);
    console.log(`Initial Wallet A native gas balance: ${formatUnits(nativeBalance, 18)} USDC`);
    console.log(`Current base fee: ${baseFeePerGas.toString()} wei/gas`);
    console.log(`Expected gas price: ${expectedGasPrice.toString()} wei/gas`);
    console.log(`Q2FA deployment calldata bytes: ${(deploymentData.length - 2) / 2}`);
    console.log(`Initial owner: ${WALLET_A}`);
    console.log(`Initial guardian public key: ${guardianKey}`);
    console.log(`Deployment gas estimate: ${deploymentGas.toString()}`);
    console.log(`Projected deployment fee: ${formatUnits(deploymentFeeEstimate, 18)} USDC`);
    console.log(`Maximum deployment fee: ${formatUnits(deploymentFeeMaximum, 18)} USDC`);
    console.log(`Reserved later deposit/withdrawal gas budget: ${formatUnits(reservedLaterFees, 18)} USDC`);
    console.log(`Projected Phase 2 maximum after this deployment: ${formatUnits(projectedPhase2Maximum, 18)} USDC`);

    requireArcAndWalletA(signer.address, await publicClient.getChainId());
    const balanceBeforeBroadcast = await publicClient.getBalance({ address: WALLET_A });
    if (balanceBeforeBroadcast < projectedPhase2Maximum) {
      throw new SafeFailure("Wallet A's balance changed below the reviewed budget. No transaction was sent.");
    }

    const walletClient = createWalletClient({ account: signer, chain: arcMainnet, transport: http(ARC_RPC_URL) });
    const hash = await walletClient.sendTransaction({
      account: signer,
      data: deploymentData,
      value: 0n,
      gas: deploymentGas,
      maxFeePerGas,
      maxPriorityFeePerGas: 0n,
    });
    console.log(`Deployment transaction hash: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
    if (receipt.status !== "success" || !receipt.contractAddress) {
      throw new SafeFailure("The single deployment transaction did not succeed with a contract address.");
    }

    const transaction = await publicClient.getTransaction({ hash });
    const effectiveGasPrice = receipt.effectiveGasPrice ?? transaction.gasPrice;
    if (!effectiveGasPrice) throw new SafeFailure("Arc did not return an effective gas price for the deployment receipt.");
    const actualFee = receipt.gasUsed * effectiveGasPrice;
    console.log(`Fresh Q2FA account: ${receipt.contractAddress}`);
    console.log(`Deployment block: ${receipt.blockNumber.toString()}`);
    console.log(`Deployment status: ${receipt.status}`);
    console.log(`Deployment gas used: ${receipt.gasUsed.toString()}`);
    console.log(`Effective gas price: ${effectiveGasPrice.toString()} wei/gas`);
    console.log(`Exact deployment network fee: ${actualFee.toString()} native units (${formatUnits(actualFee, 18)} USDC)`);
    const [code, deployedOwner, deployedGuardian, nonce] = await Promise.all([
      publicClient.getCode({ address: receipt.contractAddress }),
      publicClient.readContract({ address: receipt.contractAddress, abi: q2faAbi, functionName: "owner" }),
      publicClient.readContract({ address: receipt.contractAddress, abi: q2faAbi, functionName: "guardianKey" }),
      publicClient.readContract({ address: receipt.contractAddress, abi: q2faAbi, functionName: "nonce" }),
    ]);
    if (!code || code === "0x") throw new SafeFailure("The new account has no deployed runtime code.");
    if (deployedOwner.toLowerCase() !== WALLET_A.toLowerCase()) throw new SafeFailure("Deployed owner did not match Wallet A.");
    if (deployedGuardian.toLowerCase() !== guardianKey.toLowerCase()) throw new SafeFailure("Deployed guardian did not match the backed-up guardian.");
    if (nonce !== 0n) throw new SafeFailure("The new account nonce was not the expected initial value of zero.");

    console.log(`Deployed state verified: owner ${deployedOwner}; guardian ${deployedGuardian}; nonce ${nonce}`);
  } finally {
    seed?.fill(0);
    guardianSecret?.fill(0);
    guardianPublic?.fill(0);
    seedHex = "";
  }
}

main().catch((error: unknown) => {
  if (error instanceof SafeFailure) console.error(`Clean Phase 2 deployment stopped: ${error.message}`);
  else console.error("Clean Phase 2 deployment stopped on a local, RPC, or contract error. No retry was attempted.");
  process.exitCode = 1;
});
