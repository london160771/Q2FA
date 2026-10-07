import {
  formatUnits,
  parseAbi,
} from "viem";
import {
  ARC_CHAIN_ID,
  ARC_USDC,
  WALLET_A,
} from "@q2fa/shared";
import { arcPublicClient } from "../src/arc.js";

const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

async function main(): Promise<void> {
  const chainId = await arcPublicClient.getChainId();
  if (chainId !== ARC_CHAIN_ID) throw new Error(`RPC chain ID mismatch: ${chainId}`);

  const [nativeBalance, usdcBalance, decimals, latestBlock, gasPrice] = await Promise.all([
    arcPublicClient.getBalance({ address: WALLET_A }),
    arcPublicClient.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [WALLET_A] }),
    arcPublicClient.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "decimals" }),
    arcPublicClient.getBlock({ blockTag: "latest" }),
    arcPublicClient.getGasPrice(),
  ]);

  if (decimals !== 6) throw new Error(`Unexpected Arc USDC ERC-20 decimals: ${decimals}`);

  console.log(`Network chain ID: ${chainId}`);
  console.log(`Wallet A public address: ${WALLET_A}`);
  console.log(`Native USDC gas balance (18 decimals): ${formatUnits(nativeBalance, 18)} USDC`);
  console.log(`ERC-20 USDC balance (6 decimals): ${formatUnits(usdcBalance, decimals)} USDC`);
  console.log(`Latest block: ${latestBlock.number?.toString() ?? "unavailable"}`);
  console.log(`Current base fee: ${latestBlock.baseFeePerGas?.toString() ?? "unavailable"} wei/gas`);
  console.log(`Suggested gas price: ${gasPrice.toString()} wei/gas`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  console.error(`Arc Mainnet read failed: ${message}`);
  process.exitCode = 1;
});
