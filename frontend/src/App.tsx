import { useEffect, useState } from "react";
import { ARC_CHAIN_ID } from "@q2fa/shared";
import { connectArcMainnetWallet, type ConnectedWallet } from "./wallet.js";

export default function App() {
  const [wallet, setWallet] = useState<ConnectedWallet>();
  const [isConnecting, setIsConnecting] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.on) return;
    const onAccountsChanged = (value: unknown) => {
      if (!Array.isArray(value) || typeof value[0] !== "string") setWallet(undefined);
      else setWallet((current) => current ? { ...current, address: value[0] as `0x${string}` } : current);
    };
    const onChainChanged = (value: unknown) => {
      try {
        const chainId = Number(BigInt(String(value)));
        setWallet((current) => current ? { ...current, chainId } : current);
      } catch {
        setWallet(undefined);
      }
    };
    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  async function connect(): Promise<void> {
    setIsConnecting(true);
    setMessage(undefined);
    try {
      setWallet(await connectArcMainnetWallet());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet connection failed.");
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <main>
      <h1>Q2FA</h1>
      <p>Phase 1 smart-account foundation</p>
      <p>Arc Mainnet · Chain ID 5042</p>
      {wallet ? (
        <section aria-live="polite">
          <p>Connected account: {wallet.address}</p>
          <p>Connected chain: {wallet.chainId}</p>
          {wallet.chainId !== ARC_CHAIN_ID && <p>Switch the wallet back to Arc Mainnet to continue.</p>}
          <button type="button" onClick={() => setWallet(undefined)}>Disconnect</button>
        </section>
      ) : (
        <section>
          <button type="button" disabled={isConnecting} onClick={() => void connect()}>
            {isConnecting ? "Connecting…" : "Connect wallet"}
          </button>
          {message && <p role="status">{message}</p>}
        </section>
      )}
    </main>
  );
}
