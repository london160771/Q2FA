import { createPublicClient, http } from "viem";
import { ARC_CHAIN_ID, ARC_RPC_URL, arcMainnet } from "@q2fa/shared";

export const arcPublicClient = createPublicClient({
  chain: arcMainnet,
  transport: http(ARC_RPC_URL),
});

export async function assertArcMainnet(): Promise<void> {
  const chainId = await arcPublicClient.getChainId();
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error(`Arc RPC chain ID mismatch: expected ${ARC_CHAIN_ID}, received ${chainId}`);
  }
}
