import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  createPublicClient,
  decodeEventLog,
  formatUnits,
  getAddress,
  isAddress,
  http,
  parseUnits,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  ARC_CHAIN_ID,
  ARC_RPC_URL,
  ARC_USDC,
  AuthorizationAction,
  DEMO_RECIPIENT_WALLET,
  addressSubject,
  arcMainnet,
  encodeAuthorizationPayload,
} from "@q2fa/shared";
import { q2faFactoryAddress } from "./account-config.js";
import { accountIsSubmittable, accountOwnerMatches, buildAccountTargets, resolveAccountForOwner } from "./account-discovery.js";
import { AccountOnboarding } from "./AccountOnboarding.js";
import {
  ActivityFeed,
  LoadingPanel,
  SecurityStatusCard,
  ShortAddress,
} from "./dashboard-components.js";
import {
  buildWithdrawalPayload,
  canSubmitProtectedAction,
  formatUsdc,
  guardianMatchesOnchain,
  sortActivityNewestFirst,
  verifyWalletOnlyBlocked,
  validateSendRequest,
  type ActivityEntry,
} from "./dashboard-logic.js";
import { describeViemError, extractContractErrorName } from "./contract-errors.js";
import type { GuardianMaterial } from "./guardian.js";
import {
  arcUsdcAbi,
  guardianChangedEvent,
  ownerChangedEvent,
  q2faAccountAbi,
  usdcTransferEvent,
  withdrawalEvent,
  q2faAccountFactoryAbi,
} from "./contracts.js";
import { connectArcMainnetWallet, switchToArcMainnet, walletClientForAddress, type ConnectedWallet } from "./wallet.js";
import { AppRouter } from "./AppRouter.js";
import { DocsPage } from "./DocsPage.js";
import type { ReactNode } from "react";

const publicClient = createPublicClient({
  chain: arcMainnet,
  transport: http(import.meta.env?.DEV ? "/arc-rpc" : ARC_RPC_URL),
});
const explorerTx = "https://explorer.arc.io/tx/";
const ACTIVITY_QUERY_CHUNK_BLOCKS = 10_000n;
const ACTIVITY_QUERY_DELAY_MS = 750;

type DemoCheckState = "idle" | "running" | "passed" | "failed";

interface LiveAccount {
  address: Address;
  accountCreatedBlock: bigint;
  chainId: number;
  owner: Address;
  guardianKey: Hex;
  nonce: bigint;
  protectedBalance: bigint;
  walletUsdc: bigint;
  usdcDecimals: number;
  latestBlock: bigint;
}

type DiscoveryState = "disconnected" | "factory-unconfigured" | "loading" | "missing" | "ready" | "error";

interface PreparedWithdrawal {
  recipient: Address;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
  gasLimit: bigint;
  projectedFee: bigint;
}

interface PreparedDeposit {
  amount: bigint;
  gasLimit: bigint;
  projectedFee: bigint;
}

interface PreparedAccountCreation {
  gasLimit: bigint;
  projectedFee: bigint;
}

interface TransactionResult {
  hash: Hex;
  amount: bigint;
  recipient: Address;
  nonce: bigint;
  gasUsed: bigint;
  fee: bigint;
}

interface DepositResult {
  hash: Hex;
  amount: bigint;
  gasUsed: bigint;
  fee: bigint;
}

interface RawLog {
  blockNumber: bigint | null;
  transactionHash: Hex | null;
  logIndex: number | null;
  data: Hex;
  topics: readonly Hex[];
  args?: Record<string, unknown>;
}

export default function App() {
  const location = useLocation();
  const route = location.pathname;
  const fileInput = useRef<HTMLInputElement>(null);
  const guardian = useRef<GuardianMaterial | null>(null);
  const signature = useRef<Uint8Array | null>(null);
  const discoverySequence = useRef(0);
  const activitySequence = useRef(0);
  const [account, setAccount] = useState<LiveAccount>();
  const [wallet, setWallet] = useState<ConnectedWallet>();
  const [discoveryState, setDiscoveryState] = useState<DiscoveryState>("disconnected");
  const [discoveryRefresh, setDiscoveryRefresh] = useState(0);
  const [guardianReady, setGuardianReady] = useState(false);
  const [guardianMessage, setGuardianMessage] = useState("Guardian required");
  const [onboardingGuardianPublicKey, setOnboardingGuardianPublicKey] = useState<Hex>();
  const [onboardingBackupVerified, setOnboardingBackupVerified] = useState(false);
  const [onboardingBackupExported, setOnboardingBackupExported] = useState(false);
  const [creationEstimate, setCreationEstimate] = useState<bigint>();
  const [preparedAccountCreation, setPreparedAccountCreation] = useState<PreparedAccountCreation>();
  const [recipientText, setRecipientText] = useState("");
  const [amountText, setAmountText] = useState("");
  const [deadlineMinutes, setDeadlineMinutes] = useState("15");
  const [preparedWithdrawal, setPreparedWithdrawal] = useState<PreparedWithdrawal>();
  const [preparedDeposit, setPreparedDeposit] = useState<PreparedDeposit>();
  const [depositAmountText, setDepositAmountText] = useState("");
  const [withdrawalResult, setWithdrawalResult] = useState<TransactionResult>();
  const [depositResult, setDepositResult] = useState<DepositResult>();
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string>();
  const [activityDiagnostic, setActivityDiagnostic] = useState<string>();
  const [walletOnlyDemoState, setWalletOnlyDemoState] = useState<DemoCheckState>("idle");
  const [walletOnlyDemoMessage, setWalletOnlyDemoMessage] = useState("");
  const [twoFactorDemoState, setTwoFactorDemoState] = useState<DemoCheckState>("idle");
  const [twoFactorDemoMessage, setTwoFactorDemoMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const refreshAccount = useCallback(async (): Promise<LiveAccount> => {
    if (!wallet) throw new Error("Connect the account owner wallet to load its Q2FA account.");
    if (!q2faFactoryAddress) throw new Error("Q2FA account discovery is unavailable until the Mainnet factory is configured.");
    const result = await readAccountForOwner(wallet.address, q2faFactoryAddress);
    if (!result) throw new Error("This wallet no longer has a registered Q2FA account.");
    if (account && result.address.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error("The connected wallet now resolves to a different Q2FA account. Reload account discovery before continuing.");
    }
    setAccount(result);
    return result;
  }, [account?.address, wallet?.address]);

  const loadActivity = useCallback(async () => {
    if (!account) return;
    const requestSequence = ++activitySequence.current;
    const requestedAccount = account;
    setActivityLoading(true);
    setActivityError(undefined);
    setActivityDiagnostic(undefined);
    try {
      const latest = await publicClient.getBlockNumber();
      // Arc's RPC rejects a single deployment-to-head query; read only this account's exact events in bounded pages.
      const activityAccount = buildAccountTargets(requestedAccount.address).activity;
      const accountLogs = await getAccountLogsInChunks(activityAccount, requestedAccount.accountCreatedBlock, latest);
      const deposits = await getDepositLogsInChunks(activityAccount, requestedAccount.accountCreatedBlock, latest);

      const entries: ActivityEntry[] = [];
      for (const log of accountLogs) {
        const decoded = decodeQ2faLog(log);
        if (!decoded) continue;
        if (decoded.eventName === "Withdrawal") {
          const recipient = decoded.args.recipient as Address | undefined;
          const amount = decoded.args.amount as bigint | undefined;
          if (recipient && amount !== undefined) entries.push(logToActivity(log, "Protected withdrawal", amount, recipient, "Recipient"));
        } else if (decoded.eventName === "OwnerChanged") {
          const nextOwner = decoded.args.newOwner as Address | undefined;
          entries.push(logToActivity(log, "Owner changed", undefined, nextOwner, "New owner"));
        } else if (decoded.eventName === "GuardianChanged") {
          entries.push(logToActivity(log, "Guardian changed", undefined, undefined, "Guardian key updated"));
        }
      }
      for (const log of deposits) {
        const args = log.args ?? {};
        const from = args.from as Address | undefined;
        const value = args.value as bigint | undefined;
        if (from?.toLowerCase() !== requestedAccount.address.toLowerCase() && value !== undefined) {
          entries.push(logToActivity(log, "Deposit", value, from, "From"));
        }
      }

      const sorted = sortActivityNewestFirst(entries).slice(0, 40);
      const hashes = [...new Set(sorted.flatMap((entry) => entry.transactionHash ? [entry.transactionHash] : []))];
      const [receipts, blocks] = await Promise.all([
        Promise.all(hashes.map((hash) => publicClient.getTransactionReceipt({ hash }).catch(() => undefined))),
        Promise.all([...new Set(sorted.map((entry) => entry.blockNumber))].map((blockNumber) => publicClient.getBlock({ blockNumber }).catch(() => undefined))),
      ]);
      const receiptByHash = new Map(receipts.filter(Boolean).map((receipt) => [receipt!.transactionHash.toLowerCase(), receipt!]));
      const blockByNumber = new Map(blocks.filter(Boolean).map((block) => [block!.number, block!]));
      if (activitySequence.current !== requestSequence) return;
      setActivity(sorted.map((entry) => {
        const receipt = receiptByHash.get(entry.transactionHash.toLowerCase());
        const block = blockByNumber.get(entry.blockNumber);
        const gasPrice = receipt?.effectiveGasPrice;
        return {
          ...entry,
          timestamp: block?.timestamp,
          networkFee: receipt && gasPrice !== undefined ? receipt.gasUsed * gasPrice : undefined,
        };
      }));
    } catch (cause) {
      if (activitySequence.current !== requestSequence) return;
      setActivityError(userError(cause));
      const diagnostic = describeViemError(cause, q2faAccountAbi);
      setActivityDiagnostic(JSON.stringify(diagnostic.chain.map(({ type, name, shortMessage, errorName }) => ({ type, name, shortMessage, errorName }))));
    } finally {
      if (activitySequence.current === requestSequence) setActivityLoading(false);
    }
  }, [account?.address, account?.accountCreatedBlock]);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.on) return;
    const onAccountsChanged = (value: unknown) => {
      if (!Array.isArray(value) || typeof value[0] !== "string") {
        setWallet(undefined);
        setAccount(undefined);
        setActivity([]);
        setActivityLoading(false);
        activitySequence.current += 1;
        setDiscoveryState("disconnected");
        wipeGuardian(guardian.current);
        guardian.current = null;
        setGuardianReady(false);
        clearPrepared();
        setPreparedDeposit(undefined);
        return;
      }
      const address = getAddress(value[0]);
      setAccount(undefined);
      setActivity([]);
      setActivityLoading(false);
      activitySequence.current += 1;
      setDiscoveryState("loading");
      wipeGuardian(guardian.current);
      guardian.current = null;
      setGuardianReady(false);
      clearPrepared();
      setPreparedDeposit(undefined);
      setWallet((current) => current ? { ...current, address, walletClient: walletClientForAddress(address, provider) } : current);
    };
    const onChainChanged = (value: unknown) => {
      try {
        const chainId = Number(BigInt(String(value)));
        setWallet((current) => current ? { ...current, chainId } : current);
        clearPrepared();
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

  useEffect(() => {
    const attempt = ++discoverySequence.current;
    setAccount(undefined);
    setActivity([]);
    activitySequence.current += 1;
    setActivityError(undefined);
    setActivityDiagnostic(undefined);
    setWalletOnlyDemoState("idle");
    setTwoFactorDemoState("idle");
    clearPrepared();
    wipeGuardian(guardian.current);
    guardian.current = null;
    setGuardianReady(false);
    setGuardianMessage("Guardian required");
    setOnboardingGuardianPublicKey(undefined);
    setOnboardingBackupVerified(false);
    setOnboardingBackupExported(false);
    setCreationEstimate(undefined);
    setPreparedAccountCreation(undefined);

    if (!wallet) {
      setDiscoveryState("disconnected");
      return;
    }
    if (!q2faFactoryAddress) {
      setDiscoveryState("factory-unconfigured");
      return;
    }

    setDiscoveryState("loading");
    void readAccountForOwner(wallet.address, q2faFactoryAddress).then((live) => {
      if (discoverySequence.current !== attempt) return;
      if (!live) {
        setDiscoveryState("missing");
        return;
      }
      setAccount(live);
      setDiscoveryState("ready");
      setGuardianReady(Boolean(guardian.current && guardianMatchesOnchain(guardian.current.publicKey, live.guardianKey)));
    }).catch((cause: unknown) => {
      if (discoverySequence.current !== attempt) return;
      setDiscoveryState("error");
      setError(userError(cause));
    });

    return () => {
      if (discoverySequence.current === attempt) discoverySequence.current += 1;
    };
    // Account state is always rediscovered when the wallet address changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.address, discoveryRefresh]);

  useEffect(() => {
    if (route === "/activity" && activity.length === 0 && !activityLoading && !activityError) void loadActivity();
  }, [route, activity.length, activityError, activityLoading, loadActivity]);

  useEffect(() => () => {
    wipeGuardian(guardian.current);
    signature.current?.fill(0);
  }, []);

  useEffect(() => {
    if (!account) return;
    if (guardian.current && !guardianMatchesOnchain(guardian.current.publicKey, account.guardianKey)) {
      wipeGuardian(guardian.current);
      guardian.current = null;
      setGuardianReady(false);
      setGuardianMessage("Guardian mismatch — restore the active onchain key.");
    }
    if (preparedWithdrawal && preparedWithdrawal.nonce !== account.nonce) clearPrepared();
  }, [account?.guardianKey, account?.nonce, preparedWithdrawal]);

  function clearPrepared() {
    signature.current?.fill(0);
    signature.current = null;
    setPreparedWithdrawal(undefined);
  }

  async function connectWallet() {
    setError(undefined);
    setNotice(undefined);
    setBusy(true);
    try {
      const connected = await connectArcMainnetWallet();
      setAccount(undefined);
      setActivity([]);
      activitySequence.current += 1;
      setDiscoveryState("loading");
      wipeGuardian(guardian.current);
      guardian.current = null;
      setGuardianReady(false);
      setPreparedWithdrawal(undefined);
      setPreparedDeposit(undefined);
      setWallet(connected);
      setNotice(connected.chainId === ARC_CHAIN_ID
        ? "Wallet connected on Arc Mainnet."
        : "Wallet connected. Switch to Arc Mainnet to enable protected actions.");
    } catch (cause) {
      setError(userError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function switchNetwork() {
    setError(undefined);
    setBusy(true);
    try {
      await switchToArcMainnet();
      if (wallet) setWallet({ ...wallet, chainId: ARC_CHAIN_ID });
      setNotice("Wallet switched to Arc Mainnet.");
    } catch (cause) {
      setError(userError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function restoreGuardianFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    clearPrepared();
    const prior = guardian.current;
    wipeGuardian(prior);
    guardian.current = null;
    setGuardianReady(false);
    try {
      if (file.size > 512) throw new Error("The guardian backup file is unexpectedly large.");
      const [freshAccount, seedText] = await Promise.all([refreshAccount(), file.text()]);
      const { importGuardianSeed } = await import("./guardian.js");
      const imported = importGuardianSeed(seedText.trim());
      if (!guardianMatchesOnchain(imported.publicKey, freshAccount.guardianKey)) {
        wipeGuardian(imported);
        setGuardianMessage("Guardian mismatch — this seed does not match the active onchain guardian.");
        throw new Error("Guardian mismatch. The imported seed was cleared from memory.");
      }
      guardian.current = imported;
      setGuardianReady(true);
      setGuardianMessage("Active guardian matched");
      setNotice("Active guardian matched. The guardian is ready in this tab’s memory.");
    } catch (cause) {
      setGuardianMessage("Guardian required");
      setError(userError(cause));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
      setBusy(false);
    }
  }

  function forgetGuardian() {
    wipeGuardian(guardian.current);
    guardian.current = null;
    setGuardianReady(false);
    setGuardianMessage("Guardian required");
    clearPrepared();
    setNotice("Guardian removed from this tab’s memory.");
  }

  async function generateOnboardingGuardian() {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    clearPrepared();
    wipeGuardian(guardian.current);
    guardian.current = null;
    setGuardianReady(false);
    setOnboardingBackupVerified(false);
    setOnboardingBackupExported(false);
    setCreationEstimate(undefined);
    setPreparedAccountCreation(undefined);
    try {
      const { generateGuardian } = await import("./guardian.js");
      guardian.current = generateGuardian();
      setOnboardingGuardianPublicKey(guardian.current.publicKey);
      setGuardianMessage("Guardian created locally. Back up and verify it before account creation.");
    } catch (cause) {
      setError(userError(cause));
    } finally {
      setBusy(false);
    }
  }

  function exportOnboardingGuardianBackup() {
    const material = guardian.current;
    if (!material) return setError("Generate the guardian before creating a backup.");
    const seed = material.secretKey.slice(0, 48);
    try {
      const seedText = Array.from(seed, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const url = URL.createObjectURL(new Blob([`${seedText}\n`], { type: "text/plain" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "guardian-seed.hex";
      anchor.click();
      URL.revokeObjectURL(url);
      setOnboardingBackupExported(true);
      setNotice("Guardian backup file downloaded. Re-import that file to verify it before account creation.");
    } catch {
      setError("The guardian backup could not be downloaded. No account was created.");
    } finally {
      seed.fill(0);
    }
  }

  async function verifyOnboardingGuardianBackup(file?: File) {
    if (!file) return;
    const generated = guardian.current;
    if (!generated || !onboardingBackupExported) return setError("Generate and download the guardian backup before verifying it.");
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      if (file.size > 512) throw new Error("The guardian backup file is unexpectedly large.");
      let seedText = await file.text();
      const { importGuardianSeed, signMessage, verifyMessage } = await import("./guardian.js");
      const restored = importGuardianSeed(seedText.trim());
      seedText = "";
      if (!guardianMatchesOnchain(restored.publicKey, generated.publicKey)) {
        wipeGuardian(restored);
        throw new Error("The backup does not restore the newly generated guardian. It was cleared from memory.");
      }
      const checkMessage = toHex(new TextEncoder().encode("Q2FA_ACCOUNT_BACKUP_VERIFY_V1"));
      const checkSignature = signMessage(restored.secretKey, checkMessage);
      const valid = verifyMessage(restored.publicKey, checkMessage, checkSignature);
      checkSignature.fill(0);
      if (!valid) {
        wipeGuardian(restored);
        throw new Error("The restored guardian failed its local sign/verify check.");
      }
      wipeGuardian(generated);
      guardian.current = restored;
      setOnboardingGuardianPublicKey(restored.publicKey);
      setOnboardingBackupVerified(true);
      setCreationEstimate(undefined);
      setPreparedAccountCreation(undefined);
      setGuardianMessage("Backup restoration verified locally");
      setNotice("Backup restoration verified locally. The guardian remains in this tab’s memory only.");
    } catch (cause) {
      setOnboardingBackupVerified(false);
      setError(userError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function reviewAccountCreation() {
    setError(undefined);
    setNotice(undefined);
    setCreationEstimate(undefined);
    setPreparedAccountCreation(undefined);
    if (!wallet || !guardian.current || !onboardingBackupVerified) return setError("Connect your wallet and verify the guardian backup before account creation.");
    if (!q2faFactoryAddress) return setError("The Arc Mainnet Q2FA account factory has not been deployed and configured yet.");
    if (wallet.chainId !== ARC_CHAIN_ID) return setError("Switch to Arc Mainnet before creating an account.");
    setBusy(true);
    try {
      const chainId = await publicClient.getChainId();
      if (chainId !== ARC_CHAIN_ID) throw new Error("Arc Mainnet RPC returned an unexpected chain ID.");
      const existing = await publicClient.readContract({ address: q2faFactoryAddress, abi: q2faAccountFactoryAbi, functionName: "accountOf", args: [wallet.address] });
      if (!isZeroAddress(existing)) throw new Error("This wallet already has a factory-registered Q2FA account. Refresh discovery before continuing.");
      const request = {
        address: q2faFactoryAddress,
        abi: q2faAccountFactoryAbi,
        functionName: "createAccount" as const,
        args: [guardian.current.publicKey] as const,
        account: wallet.address,
      };
      await publicClient.simulateContract(request);
      const gas = await publicClient.estimateContractGas(request);
      const estimate = await estimateFee(gas);
      setPreparedAccountCreation({ gasLimit: estimate.gasLimit, projectedFee: estimate.projectedFee });
      setCreationEstimate(estimate.projectedFee);
      setNotice("Account creation simulation passed. Review the Mainnet fee before asking your wallet to create the account.");
    } catch (cause) {
      setError(userError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createUserAccount() {
    const prepared = preparedAccountCreation;
    if (!wallet || !guardian.current || !onboardingBackupVerified || !prepared || !q2faFactoryAddress) {
      return setError("Review account creation and verify the guardian backup before submitting.");
    }
    if (wallet.chainId !== ARC_CHAIN_ID) return setError("Switch to Arc Mainnet before creating an account.");
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const providerChainId = Number(BigInt(String(await window.ethereum?.request({ method: "eth_chainId" }))));
      if (providerChainId !== ARC_CHAIN_ID) throw new Error("Switch to Arc Mainnet before creating an account.");
      const providerAccounts = await window.ethereum?.request({ method: "eth_accounts" });
      if (!Array.isArray(providerAccounts) || typeof providerAccounts[0] !== "string" || !accountOwnerMatches(wallet.address, getAddress(providerAccounts[0]))) {
        throw new Error("The connected owner wallet changed before account creation.");
      }
      const existing = await publicClient.readContract({ address: q2faFactoryAddress, abi: q2faAccountFactoryAbi, functionName: "accountOf", args: [wallet.address] });
      if (!isZeroAddress(existing)) throw new Error("This wallet already has a Q2FA account. Refresh discovery instead of creating a duplicate.");
      const request = {
        address: q2faFactoryAddress,
        abi: q2faAccountFactoryAbi,
        functionName: "createAccount" as const,
        args: [guardian.current.publicKey] as const,
        account: wallet.address,
      };
      await publicClient.simulateContract(request);
      const gas = await publicClient.estimateContractGas(request);
      const estimate = await estimateFee(gas);
      const hash = await wallet.walletClient.writeContract({ ...request, chain: arcMainnet, gas: estimate.gasLimit });
      setNotice("Account creation submitted. Waiting for its Arc Mainnet receipt…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
      if (receipt.status !== "success") throw new Error("Q2FA account creation reverted on Arc Mainnet.");
      const live = await readAccountForOwner(wallet.address, q2faFactoryAddress);
      if (!live || live.owner.toLowerCase() !== wallet.address.toLowerCase() || live.guardianKey.toLowerCase() !== guardian.current.publicKey.toLowerCase()) {
        throw new Error("Created account state did not match this wallet and verified guardian.");
      }
      setAccount(live);
      setDiscoveryState("ready");
      setGuardianReady(true);
      setGuardianMessage("Active guardian matched");
      setCreationEstimate(undefined);
      setPreparedAccountCreation(undefined);
      setNotice(`Q2FA account created. Arc transaction ${hash}.`);
    } catch (cause) {
      setError(userError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function prepareWithdrawal() {
    setError(undefined);
    setNotice(undefined);
    setWithdrawalResult(undefined);
    clearPrepared();
    if (!account) return setError("Arc Mainnet account state is not ready yet.");
    if (!wallet) return setError("Connect the account owner wallet before preparing a protected withdrawal.");
    if (!isOwnerWallet(wallet, account.owner)) return setError("Connected wallet is not the Q2FA owner. You can still view account state.");
    if (wallet.chainId !== ARC_CHAIN_ID) return setError("Switch to Arc Mainnet before preparing a protected withdrawal.");
    if (!guardian.current || !guardianReady || !guardianMatchesOnchain(guardian.current.publicKey, account.guardianKey)) {
      return setError("Restore the active onchain guardian before signing.");
    }
    const withdrawalAccount = buildAccountTargets(account.address).withdrawal;

    setBusy(true);
    try {
      const current = await refreshAccount();
      if (!guardianMatchesOnchain(guardian.current.publicKey, current.guardianKey)) throw new Error("The guardian changed onchain. Restore the currently active guardian again.");
      const request = validateSendRequest(recipientText, amountText, current.protectedBalance, current.usdcDecimals);
      const minutes = Number(deadlineMinutes);
      if (![5, 15, 30, 60].includes(minutes)) throw new Error("Choose a supported authorization expiry.");
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const deadline = block.timestamp + BigInt(minutes * 60);
      const payload = buildWithdrawalPayload({
        chainId: ARC_CHAIN_ID,
        account: withdrawalAccount,
        subject: addressSubject(request.recipient),
        amount: request.amount,
        nonce: current.nonce,
        deadline,
      });
      await assertContractPayload(account.address, AuthorizationAction.Withdraw, addressSubject(request.recipient), request.amount, deadline, payload);

      const { signMessage, verifyMessage } = await import("./guardian.js");
      const nextSignature = signMessage(guardian.current.secretKey, payload);
      if (!verifyMessage(guardian.current.publicKey, payload, nextSignature)) {
        nextSignature.fill(0);
        throw new Error("Local guardian signature verification failed.");
      }
      const call = {
        address: withdrawalAccount,
        abi: q2faAccountAbi,
        functionName: "withdraw" as const,
        args: [request.recipient, request.amount, deadline, toHex(nextSignature)] as const,
        account: wallet.address,
      };
      await publicClient.simulateContract(call);
      const estimate = await publicClient.estimateContractGas(call);
      const fee = await estimateFee(estimate);
      signature.current = nextSignature;
      setPreparedWithdrawal({ recipient: request.recipient, amount: request.amount, nonce: current.nonce, deadline, gasLimit: fee.gasLimit, projectedFee: fee.projectedFee });
      setNotice("Guardian approved. The exact withdrawal was simulated on Arc Mainnet and gas was estimated. Review the details before asking your owner wallet to submit.");
    } catch (cause) {
      signature.current?.fill(0);
      signature.current = null;
      setError(userError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submitWithdrawal() {
    setError(undefined);
    setNotice(undefined);
    const prepared = preparedWithdrawal;
    const pqSignature = signature.current;
    if (!prepared || !pqSignature || !wallet || !account) return setError("Prepare and review the protected action first.");
    if (!accountIsSubmittable({ connectedOwner: wallet.address, liveOwner: account.owner, discoveredAccount: account.address, submittedAccount: account.address })) {
      return setError("The connected wallet is not the verified owner of the account being submitted.");
    }
    if (!canSubmitProtectedAction({
      connectedAddress: wallet.address,
      accountOwner: account.owner,
      walletChainId: wallet.chainId,
      rpcChainId: account.chainId,
      guardianMatched: guardianReady && Boolean(guardian.current && guardianMatchesOnchain(guardian.current.publicKey, account.guardianKey)),
      simulationPassed: true,
    })) return setError("Submission is disabled until the owner wallet, Arc Mainnet, active guardian, and simulation all match.");

    setBusy(true);
    try {
      const providerChain = Number(BigInt(String(await window.ethereum?.request({ method: "eth_chainId" }))));
      if (providerChain !== ARC_CHAIN_ID) throw new Error("Switch to Arc Mainnet before submitting.");
      const current = await refreshAccount();
      if (current.owner.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("Connected wallet is not the live Q2FA owner.");
      if (current.nonce !== prepared.nonce) throw new Error("The account nonce changed. Prepare a new authorization before submitting.");
      if (current.protectedBalance < prepared.amount) throw new Error("Protected balance changed and is now below the signed amount.");
      if (BigInt(Math.floor(Date.now() / 1_000)) > prepared.deadline) throw new Error("Authorization expired. Sign a new action with a fresh deadline.");
      if (!guardian.current || !guardianMatchesOnchain(guardian.current.publicKey, current.guardianKey)) throw new Error("The active guardian changed. Restore it again before submitting.");
      const args = [prepared.recipient, prepared.amount, prepared.deadline, toHex(pqSignature)] as const;
      const withdrawalAccount = buildAccountTargets(account.address).withdrawal;
      const request = { address: withdrawalAccount, abi: q2faAccountAbi, functionName: "withdraw" as const, args, account: wallet.address };
      await publicClient.simulateContract(request);
      const gasEstimate = await publicClient.estimateContractGas(request);
      const estimate = await estimateFee(gasEstimate);
      const hash = await wallet.walletClient.writeContract({ ...request, chain: arcMainnet, gas: estimate.gasLimit });
      setNotice("Wallet submitted the withdrawal. Waiting for its Arc Mainnet receipt…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
      if (receipt.status !== "success") throw new Error("The withdrawal transaction reverted on Arc Mainnet.");
      const fee = receipt.gasUsed * (receipt.effectiveGasPrice ?? estimate.pricePerGas);
      const after = await refreshAccount();
      if (after.nonce !== prepared.nonce + 1n) throw new Error("Transaction succeeded, but the live nonce did not advance exactly once.");
      setWithdrawalResult({ hash, amount: prepared.amount, recipient: prepared.recipient, nonce: prepared.nonce, gasUsed: receipt.gasUsed, fee });
      signature.current?.fill(0);
      signature.current = null;
      setPreparedWithdrawal(undefined);
      setNotice("Protected withdrawal confirmed on Arc Mainnet.");
      if (route === "/activity") void loadActivity();
    } catch (cause) {
      setError(userError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function prepareDeposit() {
    setError(undefined);
    setNotice(undefined);
    setPreparedDeposit(undefined);
    if (!wallet || !account) return setError("Connect the account owner wallet before depositing USDC.");
    if (!isOwnerWallet(wallet, account.owner)) return setError("Connected wallet is not the Q2FA owner.");
    if (wallet.chainId !== ARC_CHAIN_ID) return setError("Switch to Arc Mainnet before depositing.");
    try {
      const value = parsePositiveUsdc(depositAmountText, account.usdcDecimals);
      if (value > account.walletUsdc) throw new Error("The connected owner wallet does not have enough Arc USDC for this deposit.");
      setBusy(true);
      const depositAccount = buildAccountTargets(account.address).deposit;
      const request = { address: ARC_USDC, abi: arcUsdcAbi, functionName: "transfer" as const, args: [depositAccount, value] as const, account: wallet.address };
      await publicClient.simulateContract(request);
      const gas = await publicClient.estimateContractGas(request);
      const estimate = await estimateFee(gas);
      setPreparedDeposit({ amount: value, gasLimit: estimate.gasLimit, projectedFee: estimate.projectedFee });
      setNotice("Deposit simulated. Deposits are ordinary USDC transfers and do not need PQ approval.");
    } catch (cause) {
      setError(userError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submitDeposit() {
    setError(undefined);
    setNotice(undefined);
    if (!preparedDeposit || !wallet || !account) return setError("Review the deposit estimate first.");
    if (wallet.address.toLowerCase() !== account.owner.toLowerCase()) return setError("Connected wallet is not the Q2FA owner.");
    if (wallet.chainId !== ARC_CHAIN_ID) return setError("Switch to Arc Mainnet before depositing.");
    setBusy(true);
    try {
      const live = await refreshAccount();
      if (live.owner.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("Wallet is no longer the live Q2FA owner.");
      if (preparedDeposit.amount > live.walletUsdc) throw new Error("Owner wallet USDC balance changed; prepare the deposit again.");
      const depositAccount = buildAccountTargets(account.address).deposit;
      const request = { address: ARC_USDC, abi: arcUsdcAbi, functionName: "transfer" as const, args: [depositAccount, preparedDeposit.amount] as const, account: wallet.address };
      await publicClient.simulateContract(request);
      const gas = await publicClient.estimateContractGas(request);
      const estimate = await estimateFee(gas);
      const hash = await wallet.walletClient.writeContract({ ...request, chain: arcMainnet, gas: estimate.gasLimit });
      setNotice("Deposit submitted. Waiting for its Arc Mainnet receipt…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
      if (receipt.status !== "success") throw new Error("The USDC deposit reverted on Arc Mainnet.");
      const fee = receipt.gasUsed * (receipt.effectiveGasPrice ?? estimate.pricePerGas);
      await refreshAccount();
      setDepositResult({ hash, amount: preparedDeposit.amount, gasUsed: receipt.gasUsed, fee });
      setPreparedDeposit(undefined);
      setNotice("USDC deposit confirmed. The balance is now held by the Q2FA account.");
      if (route === "/activity") void loadActivity();
    } catch (cause) {
      setError(userError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function runWalletOnlySimulation() {
    setError(undefined);
    setWalletOnlyDemoState("running");
    setWalletOnlyDemoMessage("");
    if (!account) {
      setWalletOnlyDemoState("failed");
      setWalletOnlyDemoMessage("Arc Mainnet account state is not ready yet.");
      return;
    }
    setBusy(true);
    try {
      const fresh = await refreshAccount();
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const deadline = block.timestamp + 300n;
      const outcome = await verifyWalletOnlyBlocked(
        () => publicClient.simulateContract({
          address: fresh.address,
          abi: q2faAccountAbi,
          functionName: "withdraw",
          args: [fresh.owner, 1n, deadline, "0x"],
          account: fresh.owner,
        }),
        (cause) => extractContractErrorName(cause, q2faAccountAbi),
      );
      const after = await refreshAccount();
      if (after.nonce !== fresh.nonce || after.guardianKey.toLowerCase() !== fresh.guardianKey.toLowerCase()) {
        throw new Error("Account state changed unexpectedly during eth_call simulation.");
      }
      setWalletOnlyDemoState("passed");
      setWalletOnlyDemoMessage(`BLOCKED: the owner-only withdrawal failed with ${outcome.revertName} (${outcome.walletOnlyReason}). Arc Mainnet eth_call changed no account state.`);
    } catch (cause) {
      setWalletOnlyDemoState("failed");
      setWalletOnlyDemoMessage(userError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function runTwoFactorSimulation() {
    setError(undefined);
    setTwoFactorDemoState("running");
    setTwoFactorDemoMessage("");
    if (!account || !guardian.current || !guardianReady || !guardianMatchesOnchain(guardian.current.publicKey, account.guardianKey)) {
      setTwoFactorDemoState("failed");
      setTwoFactorDemoMessage("Restore the active guardian and confirm its onchain match first.");
      return;
    }
    setBusy(true);
    try {
      const fresh = await refreshAccount();
      if (!guardianMatchesOnchain(guardian.current.publicKey, fresh.guardianKey)) throw new Error("The restored guardian no longer matches the live account.");
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const deadline = block.timestamp + 300n;
      const guardianKey = guardian.current.publicKey;
      const payload = encodeAuthorizationPayload({
        chainId: ARC_CHAIN_ID,
        account: buildAccountTargets(account.address).withdrawal,
        action: AuthorizationAction.ChangeGuardian,
        subject: guardianKey,
        amount: 0n,
        nonce: fresh.nonce,
        deadline,
      });
      await assertContractPayload(account.address, AuthorizationAction.ChangeGuardian, guardianKey, 0n, deadline, payload);
      const { signMessage, verifyMessage } = await import("./guardian.js");
      const signatureBytes = signMessage(guardian.current.secretKey, payload);
      try {
        if (!verifyMessage(guardian.current.publicKey, payload, signatureBytes)) throw new Error("Local guardian signature verification failed.");
        await publicClient.simulateContract({
          address: fresh.address,
          abi: q2faAccountAbi,
          functionName: "changeGuardian",
          args: [guardianKey, deadline, toHex(signatureBytes)],
          account: fresh.owner,
        });
      } finally {
        signatureBytes.fill(0);
      }
      const after = await refreshAccount();
      if (after.nonce !== fresh.nonce || after.guardianKey.toLowerCase() !== fresh.guardianKey.toLowerCase()) {
        throw new Error("Account state changed unexpectedly during eth_call simulation.");
      }
      setTwoFactorDemoState("passed");
      setTwoFactorDemoMessage("AUTHORIZED: the account owner submitted the simulated call and the active guardian signed the exact onchain payload. Arc Mainnet eth_call changed no account state.");
    } catch (cause) {
      setTwoFactorDemoState("failed");
      setTwoFactorDemoMessage(userError(cause));
    } finally {
      setBusy(false);
    }
  }

  const ownerActive = Boolean(account && wallet && account.owner.toLowerCase() === wallet.address.toLowerCase());
  const guardianActive = Boolean(account && account.guardianKey.toLowerCase() !== "0x" + "00".repeat(32));
  const guardianMatched = Boolean(account && guardian.current && guardianMatchesOnchain(guardian.current.publicKey, account.guardianKey));
  const activeTargets = account ? buildAccountTargets(account.address) : undefined;
  const connectedIsOwner = Boolean(wallet && account && activeTargets && accountIsSubmittable({ connectedOwner: wallet.address, liveOwner: account.owner, discoveredAccount: account.address, submittedAccount: activeTargets.withdrawal }));
  const canSubmit = Boolean(account && wallet && activeTargets && accountIsSubmittable({
    connectedOwner: wallet.address,
    liveOwner: account.owner,
    discoveredAccount: account.address,
    submittedAccount: activeTargets.withdrawal,
  }) && canSubmitProtectedAction({
    connectedAddress: wallet?.address,
    accountOwner: account.owner,
    walletChainId: wallet?.chainId,
    rpcChainId: account.chainId,
    guardianMatched: guardianReady && guardianMatched,
    simulationPassed: Boolean(preparedWithdrawal),
  }));

  const overviewPage: ReactNode = account ? (
    <div className="overview-page">
      <section className="hero-grid" aria-labelledby="welcome-title">
        <div className="hero-copy">
          <p className="eyebrow">Arc smart account · Post-quantum protected</p>
          <h2 id="welcome-title">Your wallet is only <span>one factor.</span></h2>
          <p className="hero-lede">Protected USDC needs approval from your EVM wallet and post-quantum guardian. One key alone cannot move funds held here.</p>
          <div className="hero-equation" aria-label="EVM wallet plus PQ guardian equals protected action">
            <span>Factor 1 <strong>EVM wallet</strong></span><b aria-hidden="true">+</b><span>Factor 2 <strong>PQ guardian</strong></span><b aria-hidden="true">=</b><span className="equation-result">Protected action</span>
          </div>
        </div>
        <SecurityStatusCard
          owner={account.owner}
          guardianKey={account.guardianKey}
          nonce={account.nonce}
          ownerActive={ownerActive}
          guardianActive={guardianActive}
          guardianReady={guardianReady && guardianMatched}
        />
      </section>

      <div className="overview-grid">
        <section className="balance-card" aria-labelledby="balance-title">
          <div className="balance-topline"><p className="eyebrow">Protected balance</p><span className="balance-token">ARC USDC <i aria-hidden="true" /></span></div>
          <h2 id="balance-title">{formatUnits(account.protectedBalance, account.usdcDecimals)} <span>USDC</span></h2>
          <p>Live balance held inside the Q2FA account.</p>
          <div className="balance-card-footer">
            <Link className="button button-primary" to="/send">Send protected USDC</Link>
            <Link className="text-button" to="/deposit">Deposit</Link>
            <button className="text-button" type="button" onClick={() => void refreshAccount().then(() => setNotice("Account state refreshed from Arc Mainnet.")).catch((cause) => setError(userError(cause)))} disabled={busy}>Refresh</button>
          </div>
        </section>
        <section className="content-card account-card" aria-labelledby="account-details-title">
          <div className="section-heading"><div><p className="eyebrow">Live Arc state</p><h2 id="account-details-title">Account details</h2></div><span className="live-label"><span className="live-dot" aria-hidden="true" />Live</span></div>
          <dl className="details-list">
            <DetailRow label="Owner wallet" value={account.owner} />
            <DetailRow label="Guardian key" value={account.guardianKey} />
            <DetailRow label="Network" value="Arc Mainnet · Chain 5042" />
            <DetailRow label="Q2FA account" value={account.address} />
            <DetailRow label="Current nonce" value={account.nonce.toString()} />
          </dl>
        </section>
      </div>

      <div className="overview-lower">
        <section className="content-card guardian-card" aria-labelledby="guardian-title">
          <div className="section-heading"><div><p className="eyebrow">Factor 2</p><h2 id="guardian-title">Post-quantum guardian</h2></div><span className={"status-pill" + (guardianReady && guardianMatched ? " is-good" : " is-pending")}>{guardianReady && guardianMatched ? "Ready" : "Required"}</span></div>
          <p className="card-copy">Import your active guardian seed from a local file. It is derived here and held in this tab’s memory only.</p>
          <p className={"guardian-state" + (guardianReady && guardianMatched ? " is-ready" : "")} role="status">{guardianReady && guardianMatched ? "Active guardian matched" : guardianReady ? "Guardian mismatch — restore the active key" : guardianMessage}</p>
          <input ref={fileInput} className="visually-hidden" type="file" accept=".hex,text/plain" aria-label="Import local guardian seed hex file" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void restoreGuardianFile(file); }} />
          <div className="guardian-actions"><button className="button button-secondary" type="button" onClick={() => fileInput.current?.click()} disabled={busy}>Restore guardian</button>{guardianReady && <button className="text-button" type="button" onClick={forgetGuardian} disabled={busy}>Forget in this tab</button>}</div>
          <p className="microcopy">The seed is not written to browser storage or sent to a server.</p>
        </section>
        <aside className="caution-card" aria-label="Wallet protection limitation">
          <span className="caution-icon" aria-hidden="true">!</span><div><h2>Funds outside this account are not protected</h2><p>Q2FA protects funds held in the smart account. USDC left in your regular EVM wallet does not receive this protection.</p></div>
        </aside>
      </div>

      <section className="recent-activity-block" aria-labelledby="recent-activity-heading">
        <div className="section-heading"><div><p className="eyebrow">From Arc Mainnet</p><h2 id="recent-activity-heading">Recent activity</h2></div><Link className="text-button" to="/activity">View all activity</Link></div>
        {activity.length > 0 || activityLoading || activityError ? (
          <ActivityFeed items={activity} loading={activityLoading} error={activityError} diagnostic={activityDiagnostic} title="Latest account events" limit={3} />
        ) : (
          <div className="content-card recent-activity-empty"><p>Onchain activity is available directly from Arc.</p><Link className="button button-secondary button-compact" to="/activity">Load account activity</Link></div>
        )}
      </section>
    </div>
  ) : <LoadingPanel label="Loading live Arc account state…" />;

  const sendPage: ReactNode = account ? (
    <section className="send-layout" aria-labelledby="send-title">
      <div className="page-intro"><p className="eyebrow">Protected action · Arc Mainnet</p><h2 id="send-title">Send USDC</h2><p>Both independent factors approve the same withdrawal before the account can release funds.</p></div>
      <ol className="flow-steps" aria-label="Withdrawal steps">
        <li className="is-current"><span>01</span><strong>Review action</strong></li><li className={guardianReady && guardianMatched ? "is-ready" : ""}><span>02</span><strong>PQ guardian</strong></li><li className={preparedWithdrawal ? "is-ready" : ""}><span>03</span><strong>EVM submission</strong></li>
      </ol>
      <div className="send-card content-card">
        <div className="send-form-grid">
          <label className="field field-wide"><span>Recipient address</span><input autoComplete="off" spellCheck={false} type="text" value={recipientText} onChange={(event) => { setRecipientText(event.target.value); clearPrepared(); setWithdrawalResult(undefined); }} placeholder="0x…" aria-describedby="recipient-help" /><small id="recipient-help">{recipientText.trim() && isAddress(recipientText.trim(), { strict: false }) ? "Valid EVM address" : "Enter the wallet address that should receive USDC."}</small></label>
          <label className="field"><span>Amount</span><span className="input-with-suffix"><input inputMode="decimal" type="text" value={amountText} onChange={(event) => { setAmountText(event.target.value); clearPrepared(); setWithdrawalResult(undefined); }} placeholder="0.00" aria-label="USDC amount" /><span>USDC</span></span><small>Available: {formatUnits(account.protectedBalance, account.usdcDecimals)} USDC</small></label>
          <label className="field"><span>Authorization expires in</span><select value={deadlineMinutes} onChange={(event) => { setDeadlineMinutes(event.target.value); clearPrepared(); }}><option value="5">5 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option></select><small>Short expiry limits how long approval remains usable.</small></label>
        </div>
        <button className="text-button demo-recipient" type="button" onClick={() => { setRecipientText(DEMO_RECIPIENT_WALLET); clearPrepared(); }}>Use demo recipient</button>

        {recipientText && amountText && <section className="action-review" aria-labelledby="review-title">
          <div className="review-heading"><div><p className="eyebrow">Step 1 · Review</p><h3 id="review-title">Exact action to authorize</h3></div><span className="balance-mini">Balance · {formatUnits(account.protectedBalance, account.usdcDecimals)} USDC</span></div>
          <dl className="review-grid"><ReviewRow label="Recipient" value={safeAddressPreview(recipientText)} /><ReviewRow label="Amount" value={safeAmountPreview(amountText)} /><ReviewRow label="Q2FA account" value={shortAddress(account.address)} /><ReviewRow label="Nonce" value={account.nonce.toString()} /><ReviewRow label="Expiry" value={deadlineMinutes + " minutes after signing"} /><ReviewRow label="Network" value="Arc Mainnet · 5042" /></dl>
        </section>}

        <div className={"factor-step" + (guardianReady && guardianMatched ? " is-complete" : "")}>
          <span className="step-number">2</span><div className="step-copy"><span>Factor 2 · PQ Guardian</span><strong>{guardianReady && guardianMatched ? "Guardian ready" : "Guardian required"}</strong><small>{guardianReady && guardianMatched ? "The active key matches the onchain guardian." : "Restore the active guardian from Overview."}</small></div>{guardianReady && guardianMatched && <span className="step-check" aria-label="Guardian matched">✓</span>}
        </div>
        {preparedWithdrawal && <div className="approval-summary" role="status"><strong>Guardian approved</strong><span>Exact action simulated successfully on Arc Mainnet.</span><span>Estimated network fee: <b>~{formatUnits(preparedWithdrawal.projectedFee, 18)} USDC</b></span></div>}
        <button className="button button-primary sign-button" type="button" onClick={() => void prepareWithdrawal()} disabled={busy || !guardianReady || !guardianMatched || !connectedIsOwner || wallet?.chainId !== ARC_CHAIN_ID || !recipientText || !amountText}>{busy ? "Preparing…" : preparedWithdrawal ? "Sign again with guardian" : "Sign with guardian"}</button>
        {wallet && !connectedIsOwner && <p className="inline-hint">Connected wallet is not the Q2FA owner. Signing and submission are disabled.</p>}
        {wallet && wallet.chainId !== ARC_CHAIN_ID && <p className="inline-hint">Switch to Arc Mainnet before signing or submitting.</p>}

        <div className={"factor-step" + (preparedWithdrawal ? " is-complete" : " is-muted")}>
          <span className="step-number">3</span><div className="step-copy"><span>Factor 1 · EVM Wallet</span><strong>{connectedIsOwner ? "Owner wallet connected" : "Connect the account owner"}</strong><small>Only this account’s live owner can submit the approved withdrawal.</small></div>{connectedIsOwner && <span className="step-check" aria-label="Owner wallet connected">✓</span>}
        </div>
        <button className="button button-submit" type="button" onClick={() => void submitWithdrawal()} disabled={busy || !canSubmit}>{busy ? "Waiting for Arc…" : "Submit with wallet"}</button>
        {!preparedWithdrawal && <p className="inline-hint">Submission unlocks after the guardian signs and the withdrawal simulation passes.</p>}
        {withdrawalResult && <TransactionConfirmation title="Protected withdrawal successful" hash={withdrawalResult.hash} fee={withdrawalResult.fee} gasUsed={withdrawalResult.gasUsed} amount={withdrawalResult.amount} decimals={account.usdcDecimals} recipient={withdrawalResult.recipient} nonce={withdrawalResult.nonce} />}
      </div>
    </section>
  ) : <LoadingPanel label="Loading Q2FA account before preparing an action…" />;

  const depositPage: ReactNode = account ? (
    <section className="page-section deposit-page" aria-labelledby="deposit-title">
      <div className="page-intro"><p className="eyebrow">Add protected funds</p><h2 id="deposit-title">Deposit USDC</h2><p>Protection starts after funds enter the Q2FA smart account.</p></div>
      <aside className="caution-card deposit-education"><span className="caution-icon" aria-hidden="true">!</span><div><h3>Only deposited funds receive Q2FA protection</h3><p>Funds held directly in your EVM wallet are not protected by Q2FA. Protection starts after funds enter the Q2FA smart account.</p></div></aside>
      <div className="deposit-grid">
        <section className="content-card deposit-card" aria-labelledby="deposit-form-title">
          <div className="section-heading"><div><p className="eyebrow">Arc USDC transfer</p><h3 id="deposit-form-title">Move funds into protection</h3></div><span className="deposit-note">No PQ approval needed to deposit</span></div>
          <p className="card-copy">Deposits are standard USDC transfers from the owner wallet. A protected withdrawal later requires both factors.</p>
          <label className="field deposit-amount-field"><span>Amount</span><span className="input-with-suffix"><input inputMode="decimal" type="text" value={depositAmountText} onChange={(event) => { setDepositAmountText(event.target.value); setPreparedDeposit(undefined); setDepositResult(undefined); }} placeholder="0.00" aria-label="USDC deposit amount" /><span>USDC</span></span></label>
          {!preparedDeposit ? <button className="button button-secondary" type="button" onClick={() => void prepareDeposit()} disabled={busy || !connectedIsOwner || wallet?.chainId !== ARC_CHAIN_ID}>Review deposit</button> : <button className="button button-primary" type="button" onClick={() => void submitDeposit()} disabled={busy || !connectedIsOwner || wallet?.chainId !== ARC_CHAIN_ID}>{busy ? "Waiting for Arc…" : "Deposit with wallet"}</button>}
          {preparedDeposit && <p className="fee-preview">Deposit {formatUsdc(preparedDeposit.amount, account.usdcDecimals)} · Estimated Arc network fee: <strong>~{formatUnits(preparedDeposit.projectedFee, 18)} USDC</strong></p>}
          {depositResult && <TransactionConfirmation title="Deposit confirmed" hash={depositResult.hash} fee={depositResult.fee} gasUsed={depositResult.gasUsed} amount={depositResult.amount} decimals={account.usdcDecimals} />}
        </section>
        <section className="content-card deposit-balances" aria-labelledby="deposit-balances-title">
          <p className="eyebrow">Live balances</p><h3 id="deposit-balances-title">Before transfer</h3>
          <dl className="details-list"><DetailRow label="Connected wallet USDC" value={formatUnits(account.walletUsdc, account.usdcDecimals) + " USDC"} /><DetailRow label="Protected balance" value={formatUnits(account.protectedBalance, account.usdcDecimals) + " USDC"} /><DetailRow label="Q2FA account" value={account.address} /><DetailRow label="Network" value="Arc Mainnet · Chain 5042" /></dl>
          <p className="microcopy">Wallet balance and protected account balance are separate. Arc network fees are also paid in USDC.</p>
        </section>
      </div>
    </section>
  ) : <LoadingPanel label="Loading live balances from Arc Mainnet…" />;

  const activityPage: ReactNode = account ? (
    <section className="page-section" aria-labelledby="activity-page-title">
      <div className="page-intro"><p className="eyebrow">Onchain history</p><h2 id="activity-page-title">Activity</h2><p>Account events and Arc USDC transfers read directly from Mainnet. No activity database is used.</p></div>
      <ActivityFeed items={activity} loading={activityLoading} error={activityError} diagnostic={activityDiagnostic} description={"Showing up to 40 real events since this account was created at block " + account.accountCreatedBlock.toString() + ". Arc logs are filtered by this account and exact event topics, then paged in up to 10,000-block reads."} emptyAction={<button className="button button-secondary" type="button" onClick={() => void loadActivity()} disabled={activityLoading}>Refresh activity</button>} />
      {!activityLoading && !activityError && <button className="button button-secondary refresh-activity" type="button" onClick={() => void loadActivity()} disabled={activityLoading}>Refresh activity</button>}
    </section>
  ) : <LoadingPanel label="Loading account state…" />;

  const securityPage: ReactNode = account ? (
    <section className="page-section demo-page" aria-labelledby="demo-title">
      <div className="page-intro"><p className="eyebrow">Read-only contract simulation</p><h2 id="demo-title">Security demo</h2><p>See what happens when an EVM wallet is available without a valid post-quantum approval.</p></div>
      <div className="demo-equation"><span>Factor 1 · EVM wallet</span><b aria-hidden="true">+</b><span>Factor 2 · PQ guardian</span><b aria-hidden="true">=</b><strong>Protected action</strong></div>
      <div className="demo-grid">
        <article className="attack-card" aria-labelledby="attack-title">
          <div className="demo-card-top"><span className="demo-icon attack-icon" aria-hidden="true">!</span><span className="demo-label">Attack scenario</span></div>
          <h3 id="attack-title">Stolen EVM wallet</h3>
          <ul className="factor-check-list"><li><span className="check-good">✓</span> EVM owner address is the simulated sender</li><li><span className="check-bad">×</span> PQ guardian authorization is missing</li></ul>
          <div className={"demo-result" + (walletOnlyDemoState === "passed" ? " is-blocked" : walletOnlyDemoState === "failed" ? " is-error" : "")}><span className="result-word">{walletOnlyDemoState === "running" ? "Checking…" : walletOnlyDemoState === "passed" ? "Blocked" : walletOnlyDemoState === "failed" ? "Check failed" : "Ready to test"}</span><span>{walletOnlyDemoState === "passed" ? "The contract rejected the owner-only withdrawal for missing or invalid PQ approval." : "A read-only call uses the owner address and an empty PQ signature."}</span></div>
          <button className="button button-primary demo-run" type="button" onClick={() => void runWalletOnlySimulation()} disabled={busy || !account}>{walletOnlyDemoState === "running" ? "Simulating…" : "Simulate stolen wallet"}</button>
          {walletOnlyDemoMessage && <p className={"demo-message" + (walletOnlyDemoState === "passed" ? " is-good" : " is-bad")} role={walletOnlyDemoState === "failed" ? "alert" : "status"}>{walletOnlyDemoMessage}</p>}
        </article>
        <article className="legitimate-card" aria-labelledby="legitimate-title">
          <div className="demo-card-top"><span className="demo-icon success-icon" aria-hidden="true">✓</span><span className="demo-label">Legitimate owner</span></div>
          <h3 id="legitimate-title">Both factors approve</h3>
          <ul className="factor-check-list"><li><span className="check-good">✓</span> EVM owner address set as sender</li><li><span className={guardianReady && guardianMatched ? "check-good" : "check-pending"}>{guardianReady && guardianMatched ? "✓" : "–"}</span> Active PQ guardian signs exact account payload</li></ul>
          <div className={"demo-result" + (twoFactorDemoState === "passed" ? " is-authorized" : twoFactorDemoState === "failed" ? " is-error" : "")}><span className="result-word">{twoFactorDemoState === "running" ? "Checking…" : twoFactorDemoState === "passed" ? "Authorized" : twoFactorDemoState === "failed" ? "Not verified" : "Ready to test"}</span><span>{twoFactorDemoState === "passed" ? "A valid two-factor authorization passed read-only simulation." : "Requires the active guardian restored in this tab."}</span></div>
          <button className="button button-primary demo-run" type="button" onClick={() => void runTwoFactorSimulation()} disabled={busy || !guardianReady || !guardianMatched || !guardianActive}>{twoFactorDemoState === "running" ? "Simulating…" : "Simulate with both factors"}</button>
          {!guardianReady && <p className="inline-hint">Restore the active guardian on Overview before running this simulation.</p>}
          {twoFactorDemoMessage && <p className={"demo-message" + (twoFactorDemoState === "passed" ? " is-good" : " is-bad")} role={twoFactorDemoState === "failed" ? "alert" : "status"}>{twoFactorDemoMessage}</p>}
        </article>
      </div>
      <div className="demo-explainer"><div><strong>What is being simulated?</strong><p>The first call attempts a 1-base-unit withdrawal with no PQ signature. The second signs a same-key guardian update using the live nonce. Both are Arc Mainnet read-only simulations; neither submits a transaction or changes account state.</p></div><span className="read-only-tag">READ-ONLY</span></div>
    </section>
  ) : <LoadingPanel label="Loading account before read-only simulation…" />;

  const connectAccountPage: ReactNode = <section className="content-card account-access-state"><p className="eyebrow">Your Q2FA account</p><h2>Connect a wallet to access your Q2FA account.</h2><p>Your account is discovered from the connected wallet’s onchain factory record. This app does not show another wallet’s account.</p><button className="button button-primary" type="button" onClick={() => void connectWallet()} disabled={busy}>{busy ? "Connecting…" : "Connect wallet"}</button></section>;
  const factoryUnavailablePage: ReactNode = <section className="content-card account-access-state"><p className="eyebrow">Arc Mainnet account discovery</p><h2>Account discovery is not configured yet.</h2><p>The original account remains a verified demo deployment. It will not be shown as another wallet’s account. New account discovery and creation require a verified Mainnet factory deployment.</p></section>;
  const discoveryErrorPage: ReactNode = <section className="content-card account-access-state"><p className="eyebrow">Arc Mainnet account discovery</p><h2>We could not verify this wallet’s account.</h2><p>No account data or activity is shown until its factory record and live owner are verified.</p><button className="button button-secondary" type="button" onClick={() => { setError(undefined); setDiscoveryRefresh((value) => value + 1); }} disabled={busy}>Retry account lookup</button></section>;
  const accountOnboardingPage: ReactNode = wallet ? <AccountOnboarding
    owner={wallet.address}
    factoryReady={Boolean(q2faFactoryAddress)}
    guardianKey={onboardingGuardianPublicKey}
    backupExported={onboardingBackupExported}
    backupVerified={onboardingBackupVerified}
    creationEstimate={creationEstimate}
    busy={busy}
    onGenerateGuardian={generateOnboardingGuardian}
    onExportBackup={exportOnboardingGuardianBackup}
    onImportBackup={(file) => void verifyOnboardingGuardianBackup(file)}
    onReviewCreation={() => void reviewAccountCreation()}
    onCreateAccount={() => void createUserAccount()}
  /> : connectAccountPage;
  const accountPage = (page: ReactNode): ReactNode => {
    if (!wallet || discoveryState === "disconnected") return connectAccountPage;
    if (discoveryState === "factory-unconfigured") return factoryUnavailablePage;
    if (discoveryState === "loading") return <LoadingPanel label="Discovering this wallet’s Q2FA account on Arc Mainnet…" />;
    if (discoveryState === "missing") return accountOnboardingPage;
    if (discoveryState === "error") return discoveryErrorPage;
    if (discoveryState === "ready" && account) return page;
    return <LoadingPanel label="Verifying the connected wallet’s Q2FA account…" />;
  };

  return (
    <AppRouter
      shell={{
        wallet,
        accountOwner: account?.owner,
        accountAddress: account?.address,
        busy,
        error,
        notice,
        onConnect: () => void connectWallet(),
        onSwitchNetwork: () => void switchNetwork(),
      }}
      pages={{
        overview: accountPage(overviewPage),
        send: accountPage(sendPage),
        deposit: accountPage(depositPage),
        activity: accountPage(activityPage),
        security: accountPage(securityPage),
        docs: <DocsPage />,
      }}
    />
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="detail-row"><dt>{label}</dt><dd title={value}>{label === "Owner wallet" || label === "Guardian key" ? <ShortAddress value={value} /> : value}<span className="detail-copy">{label === "Current nonce" ? "LIVE" : ""}</span></dd></div>;
}

async function readAccountForOwner(owner: Address, factoryAddress: Address): Promise<LiveAccount | undefined> {
  const [chainId, factoryCode, latestBlock] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getCode({ address: factoryAddress }),
    publicClient.getBlockNumber(),
  ]);
  if (chainId !== ARC_CHAIN_ID) throw new Error("Arc Mainnet RPC returned an unexpected chain ID.");
  if (!factoryCode || factoryCode === "0x") throw new Error("The configured Q2FA factory has no contract code on Arc Mainnet.");

  const discoveredAddress = await publicClient.readContract({
    address: factoryAddress,
    abi: q2faAccountFactoryAbi,
    functionName: "accountOf",
    args: [owner],
  });
  const resolution = resolveAccountForOwner(owner, discoveredAddress);
  if (resolution.status !== "load") return undefined;

  const [accountCode, accountCreatedBlock, liveOwner, accountRegistry, guardianKey, nonce, protectedBalance, walletUsdc, usdcDecimals] = await Promise.all([
    publicClient.getCode({ address: resolution.account }),
    publicClient.readContract({ address: factoryAddress, abi: q2faAccountFactoryAbi, functionName: "accountCreatedBlock", args: [resolution.account] }),
    publicClient.readContract({ address: resolution.account, abi: q2faAccountAbi, functionName: "owner" }),
    publicClient.readContract({ address: resolution.account, abi: q2faAccountAbi, functionName: "registry" }),
    publicClient.readContract({ address: resolution.account, abi: q2faAccountAbi, functionName: "guardianKey" }),
    publicClient.readContract({ address: resolution.account, abi: q2faAccountAbi, functionName: "nonce" }),
    publicClient.readContract({ address: ARC_USDC, abi: arcUsdcAbi, functionName: "balanceOf", args: [resolution.account] }),
    publicClient.readContract({ address: ARC_USDC, abi: arcUsdcAbi, functionName: "balanceOf", args: [owner] }),
    publicClient.readContract({ address: ARC_USDC, abi: arcUsdcAbi, functionName: "decimals" }),
  ]);
  if (!accountCode || accountCode === "0x") throw new Error("The factory returned an account without Arc Mainnet contract code.");
  if (accountRegistry.toLowerCase() !== factoryAddress.toLowerCase()) throw new Error("The discovered account does not reference the configured Q2FA factory.");
  if (!accountOwnerMatches(owner, liveOwner)) throw new Error("The factory account owner does not match the connected wallet. No account data was loaded.");
  if (usdcDecimals !== 6) throw new Error(`Arc USDC reports ${usdcDecimals} decimals; this client expects 6.`);

  return { address: resolution.account, accountCreatedBlock, chainId, owner: liveOwner, guardianKey, nonce, protectedBalance, walletUsdc, usdcDecimals, latestBlock };
}

function isZeroAddress(address: Address): boolean {
  return /^0x0{40}$/i.test(address);
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd title={value}>{value}</dd></div>;
}

function TransactionConfirmation({
  title,
  hash,
  fee,
  gasUsed,
  amount,
  decimals,
  recipient,
  nonce,
}: {
  title: string;
  hash: Hex;
  fee: bigint;
  gasUsed: bigint;
  amount: bigint;
  decimals: number;
  recipient?: Address;
  nonce?: bigint;
}) {
  return <div className="transaction-confirmation" role="status"><h3>✓ {title}</h3><dl><div><dt>Amount</dt><dd>{formatUsdc(amount, decimals)}</dd></div>{recipient && <div><dt>Recipient</dt><dd><ShortAddress value={recipient} /></dd></div>}{nonce !== undefined && <div><dt>Nonce used</dt><dd>{nonce.toString()}</dd></div>}<div><dt>Actual network fee</dt><dd>{formatUnits(fee, 18)} USDC</dd></div><div><dt>Gas used</dt><dd>{gasUsed.toString()}</dd></div></dl><a href={`${explorerTx}${hash}`} target="_blank" rel="noreferrer">View transaction <ShortAddress value={hash} /></a></div>;
}

async function getAccountLogsInChunks(account: Address, fromBlock: bigint, toBlock: bigint): Promise<RawLog[]> {
  return getActivityLogsInChunks(fromBlock, toBlock, (start, end) => publicClient.getLogs({
    address: account,
    events: [withdrawalEvent, ownerChangedEvent, guardianChangedEvent] as const,
    fromBlock: start,
    toBlock: end,
  }) as unknown as Promise<RawLog[]>);
}

async function getDepositLogsInChunks(account: Address, fromBlock: bigint, toBlock: bigint): Promise<RawLog[]> {
  return getActivityLogsInChunks(fromBlock, toBlock, (start, end) => publicClient.getLogs({
    address: ARC_USDC,
    event: usdcTransferEvent,
    args: { to: account },
    fromBlock: start,
    toBlock: end,
  }) as unknown as Promise<RawLog[]>);
}

async function getActivityLogsInChunks(
  fromBlock: bigint,
  toBlock: bigint,
  query: (fromBlock: bigint, toBlock: bigint) => Promise<RawLog[]>,
): Promise<RawLog[]> {
  const result: RawLog[] = [];
  let pageSize = ACTIVITY_QUERY_CHUNK_BLOCKS;
  let start = fromBlock;
  let hasQueried = false;
  while (start <= toBlock) {
    let end = start + pageSize - 1n < toBlock ? start + pageSize - 1n : toBlock;
    if (hasQueried) await delay(ACTIVITY_QUERY_DELAY_MS);
    let retries = 0;
    while (true) {
      try {
        result.push(...await query(start, end));
        hasQueried = true;
        start = end + 1n;
        break;
      } catch (cause) {
        if (isLogRangeError(cause) && pageSize > 1n) {
          pageSize = pageSize / 2n;
          end = start + pageSize - 1n < toBlock ? start + pageSize - 1n : toBlock;
          retries = 0;
          await delay(ACTIVITY_QUERY_DELAY_MS);
          continue;
        }
        if (isRateLimitError(cause)) {
          const requestedRange = end - start + 1n;
          if (requestedRange > 1n) {
            // Arc can rate-limit broad USDC Transfer filters even when the
            // block range is below its maximum. Retry the same address/topic
            // filter over smaller ranges instead of repeating a doomed query.
            pageSize = requestedRange / 2n;
            end = start + pageSize - 1n;
            retries = 0;
            await delay(ACTIVITY_QUERY_DELAY_MS);
            continue;
          }
          if (retries < 3) {
            retries += 1;
            await delay(ACTIVITY_QUERY_DELAY_MS * retries * 2);
            continue;
          }
        }
        throw cause;
      }
    }
  }
  return result;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function errorChainText(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; current && depth < 8 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current !== "object") break;
    for (const key of ["name", "shortMessage", "details", "message"] as const) {
      const value = Reflect.get(current, key);
      if (typeof value === "string") messages.push(value);
    }
    current = Reflect.get(current, "cause");
  }
  return messages.join(" ").toLowerCase();
}

function isLogRangeError(error: unknown): boolean {
  const message = errorChainText(error);
  return /requested range too large|request(?:ed)? range.{0,40}(?:exceed|limit|large)|exceeds defined limit|limitexceededrpcerror/.test(message);
}

function isRateLimitError(error: unknown): boolean {
  const message = errorChainText(error);
  return /rate limit exceeded|too many requests|ratelimitexceededrpcerror/.test(message);
}

function decodeQ2faLog(log: RawLog): { eventName: string; args: Record<string, unknown> } | undefined {
  try {
    if (log.topics.length === 0) return undefined;
    return decodeEventLog({
      abi: [withdrawalEvent, ownerChangedEvent, guardianChangedEvent],
      data: log.data,
      topics: [...log.topics] as [Hex, ...Hex[]],
    }) as unknown as { eventName: string; args: Record<string, unknown> };
  } catch {
    return undefined;
  }
}

async function assertContractPayload(account: Address, action: 0 | 1 | 2, subject: Hex, amount: bigint, deadline: bigint, clientPayload: Hex) {
  const onchainPayload = await publicClient.readContract({
    address: account,
    abi: q2faAccountAbi,
    functionName: "authorizationPayload",
    args: [action, subject, amount, deadline],
  });
  if (clientPayload.toLowerCase() !== onchainPayload.toLowerCase()) {
    throw new Error("The client payload does not match the deployed contract encoding. No signature was submitted.");
  }
}

async function estimateFee(gasEstimate: bigint): Promise<{ gasLimit: bigint; pricePerGas: bigint; projectedFee: bigint }> {
  const fees = await publicClient.estimateFeesPerGas();
  const pricePerGas = ("maxFeePerGas" in fees ? fees.maxFeePerGas : undefined)
    ?? ("gasPrice" in fees ? fees.gasPrice : undefined);
  if (!pricePerGas || pricePerGas <= 0n) throw new Error("Arc did not provide a usable gas price.");
  const gasLimit = gasEstimate + (gasEstimate + 4n) / 5n;
  return { gasLimit, pricePerGas, projectedFee: gasLimit * pricePerGas };
}

function parsePositiveUsdc(value: string, decimals: number): bigint {
  const text = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("Enter a USDC amount using digits and an optional decimal point.");
  if ((text.split(".")[1]?.length ?? 0) > decimals) throw new Error(`Arc USDC supports up to ${decimals} decimal places.`);
  const parsed = parseUnits(text, decimals);
  if (parsed <= 0n) throw new Error("Enter an amount greater than zero.");
  return parsed;
}

function logToActivity(log: RawLog, action: ActivityEntry["action"], amount?: bigint, address?: Address, addressLabel?: string): ActivityEntry {
  if (log.blockNumber === null || log.transactionHash === null) throw new Error("Arc returned an incomplete account activity log.");
  return {
    id: `${log.transactionHash}-${log.logIndex ?? 0}`,
    action,
    amount,
    address,
    addressLabel,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
  };
}

function isOwnerWallet(wallet: ConnectedWallet, owner: Address): boolean {
  return wallet.address.toLowerCase() === owner.toLowerCase();
}

function wipeGuardian(material: GuardianMaterial | null): void {
  material?.secretKey.fill(0);
}

function safeAddressPreview(value: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim()) ? `${value.trim().slice(0, 10)}…${value.trim().slice(-8)}` : "Enter valid address";
}

function safeAmountPreview(value: string): string {
  return /^\d+(?:\.\d+)?$/.test(value.trim()) ? `${value.trim()} USDC` : "Enter valid amount";
}

function shortAddress(value: string): string {
  return value.length < 20 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function userError(cause: unknown): string {
  const customError = extractContractErrorName(cause, [...q2faAccountAbi, ...q2faAccountFactoryAbi]);
  const knownErrors: Record<string, string> = {
    AuthorizationExpired: "This authorization expired. Prepare a new action with a fresh deadline.",
    InvalidPQSignature: "The post-quantum guardian signature did not match this action.",
    InvalidPQSignatureLength: "The guardian signature has an unexpected size.",
    NotOwner: "Connected wallet is not the Q2FA owner.",
    ZeroRecipient: "The zero address cannot receive protected USDC.",
    ZeroAmount: "Enter an amount greater than zero.",
    USDCTransferFailed: "The USDC transfer failed. Check the protected balance and Arc USDC status.",
    PQVerifierUnavailable: "Arc’s post-quantum verifier did not respond. Try again later.",
    AccountAlreadyExists: "This wallet already owns a Q2FA account.",
    UnregisteredAccount: "The factory did not recognize this Q2FA account for owner discovery.",
    InvalidOwnerChange: "The requested owner change cannot be applied to this account.",
    WrongChain: "Q2FA account creation is available only on Arc Mainnet.",
    ZeroGuardian: "Generate a valid post-quantum guardian before creating an account.",
    LimitExceededRpcError: "Arc’s RPC rejected the event range. Activity will retry using smaller pages.",
    RateLimitExceededRpcError: "Arc’s RPC is rate limiting activity reads. Wait a moment, then refresh activity.",
  };
  if (customError && knownErrors[customError]) return knownErrors[customError]!;
  if (typeof cause === "object" && cause !== null && "shortMessage" in cause && typeof cause.shortMessage === "string") {
    return sanitizeDiagnosticText(cause.shortMessage);
  }
  if (cause instanceof Error) {
    const message = sanitizeDiagnosticText(cause.message);
    return message || "The operation failed. Check the wallet and Arc Mainnet state.";
  }
  return "The operation failed. Check the wallet and Arc Mainnet state.";
}

function sanitizeDiagnosticText(message: string): string {
  return message.replace(/0x[0-9a-fA-F]{64,}/g, "[transaction data]").slice(0, 240);
}
