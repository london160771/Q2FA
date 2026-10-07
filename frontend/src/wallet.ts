import { createWalletClient, custom, getAddress, toHex, type Address } from "viem";
import { ARC_CHAIN_ID, ARC_RPC_URL, arcMainnet } from "@q2fa/shared";

export interface InjectedProvider {
  request: (...args: any[]) => Promise<any>;
  on?: (event: string, listener: (value: unknown) => void) => void;
  removeListener?: (event: string, listener: (value: unknown) => void) => void;
}

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}

export interface ConnectedWallet {
  address: Address;
  chainId: number;
  walletClient: ReturnType<typeof createWalletClient>;
}

export async function connectArcMainnetWallet(): Promise<ConnectedWallet> {
  const provider = window.ethereum;
  if (!provider) throw new Error("No injected EVM wallet was detected in this browser.");

  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new Error("The wallet did not return an account.");
  }

  await switchToArcMainnet(provider);
  const chainId = Number(BigInt(String(await provider.request({ method: "eth_chainId" }))));
  if (chainId !== ARC_CHAIN_ID) throw new Error("The wallet is not connected to Arc Mainnet.");

  const address = getAddress(accounts[0]);
  const walletClient = createWalletClient({ account: address, chain: arcMainnet, transport: custom(provider) });
  return { address, chainId, walletClient };
}

export async function switchToArcMainnet(provider = window.ethereum): Promise<void> {
  if (!provider) throw new Error("No injected EVM wallet was detected in this browser.");
  const chainId = toHex(ARC_CHAIN_ID);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    if (getWalletErrorCode(error) !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId,
        chainName: "Arc Mainnet",
        nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
        rpcUrls: [ARC_RPC_URL],
      }],
    });
  }
}

function getWalletErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}
