import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  getAddress,
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
  Q2FA_ACCOUNT,
  WALLET_A,
  WALLET_B,
  addressSubject,
  arcMainnet,
  encodeAuthorizationPayload,
} from "@q2fa/shared";
import { destroyGuardian, generateGuardian, importGuardianSeed, signMessage, verifyMessage, type GuardianMaterial } from "./guardian.js";
import { arcUsdcAbi, q2faAccountAbi } from "./contracts.js";
import { describeViemError, extractContractErrorName } from "./contract-errors.js";
import { connectArcMainnetWallet, type ConnectedWallet } from "./wallet.js";

const explorerBase = "https://explorer.arc.io/tx/";
const phase2FeeLimit = parseUnits("0.05", 18);
const demoAmount = 1n;
const publicClient = createPublicClient({ chain: arcMainnet, transport: http(ARC_RPC_URL) });

interface AccountSnapshot {
  owner: Address;
  guardianKey: Hex;
  nonce: bigint;
  accountUsdc: bigint;
  walletAUsdc: bigint;
  walletANativeBalance: bigint;
  walletBUsdc: bigint;
  usdcDecimals: number;
}

interface SignedAuthorization {
  action: "rotation" | "withdrawal";
  payload: Hex;
  signature: Uint8Array;
  nonce: bigint;
  deadline: bigint;
  subject: Hex;
  amount: bigint;
  publicKey: Hex;
}

interface TransactionRecord {
  label: string;
  hash: Hex;
  block: string;
  status: string;
  gasUsed: string;
  gasPrice: string;
  fee: bigint;
  calldataBytes: number;
}

interface FeeProjection {
  gasLimit: bigint;
  pricePerGas: bigint;
  projectedFee: bigint;
}

export default function App() {
  const seedInput = useRef<HTMLInputElement>(null);
  const activeGuardianSeedInput = useRef<HTMLInputElement>(null);
  const oldGuardian = useRef<GuardianMaterial | null>(null);
  const newGuardian = useRef<GuardianMaterial | null>(null);
  const signedAuthorization = useRef<SignedAuthorization | null>(null);

  const [wallet, setWallet] = useState<ConnectedWallet>();
  const [snapshot, setSnapshot] = useState<AccountSnapshot>();
  const [oldGuardianPublicKey, setOldGuardianPublicKey] = useState<Hex>();
  const [newGuardianPublicKey, setNewGuardianPublicKey] = useState<Hex>();
  const [signedAction, setSignedAction] = useState<string>();
  const [negativeChecks, setNegativeChecks] = useState<string[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [phase2Fees, setPhase2Fees] = useState(0n);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Read-only Arc Mainnet state is loading.");
  const [error, setError] = useState<string>();

  const refreshState = useCallback(async (): Promise<AccountSnapshot> => {
    const [chainId, code] = await Promise.all([
      publicClient.getChainId(),
      publicClient.getCode({ address: Q2FA_ACCOUNT }),
    ]);
    if (chainId !== ARC_CHAIN_ID) throw new Error("RPC chain ID did not match Arc Mainnet (5042).");
    if (!code || code === "0x") throw new Error("The configured Q2FA account has no deployed code.");

    const [owner, guardianKey, nonce, accountUsdc, walletAUsdc, walletANativeBalance, walletBUsdc, usdcDecimals] = await Promise.all([
      publicClient.readContract({ address: Q2FA_ACCOUNT, abi: q2faAccountAbi, functionName: "owner" }),
      publicClient.readContract({ address: Q2FA_ACCOUNT, abi: q2faAccountAbi, functionName: "guardianKey" }),
      publicClient.readContract({ address: Q2FA_ACCOUNT, abi: q2faAccountAbi, functionName: "nonce" }),
      publicClient.readContract({ address: ARC_USDC, abi: arcUsdcAbi, functionName: "balanceOf", args: [Q2FA_ACCOUNT] }),
      publicClient.readContract({ address: ARC_USDC, abi: arcUsdcAbi, functionName: "balanceOf", args: [WALLET_A] }),
      publicClient.getBalance({ address: WALLET_A }),
      publicClient.readContract({ address: ARC_USDC, abi: arcUsdcAbi, functionName: "balanceOf", args: [WALLET_B] }),
      publicClient.readContract({ address: ARC_USDC, abi: arcUsdcAbi, functionName: "decimals" }),
    ]);
    if (usdcDecimals !== 6) throw new Error(`Arc USDC reported ${usdcDecimals} decimals; expected 6.`);

    const next: AccountSnapshot = { owner, guardianKey, nonce, accountUsdc, walletAUsdc, walletANativeBalance, walletBUsdc, usdcDecimals };
    setSnapshot(next);
    return next;
  }, []);

  const clearSensitiveMemory = useCallback(() => {
    destroyGuardian(oldGuardian.current);
    destroyGuardian(newGuardian.current);
    oldGuardian.current = null;
    newGuardian.current = null;
    signedAuthorization.current?.signature.fill(0);
    signedAuthorization.current = null;
    setOldGuardianPublicKey(undefined);
    setNewGuardianPublicKey(undefined);
    setSignedAction(undefined);
    setNegativeChecks([]);
    if (seedInput.current) seedInput.current.value = "";
    if (activeGuardianSeedInput.current) activeGuardianSeedInput.current.value = "";
  }, []);

  useEffect(() => {
    void refreshState().then(() => setStatus("Connected to the deployed Arc Mainnet account.")).catch((cause: unknown) => {
      setError(safeErrorMessage(cause));
      setStatus("Could not read the configured Arc Mainnet account.");
    });
  }, [refreshState]);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.on) return;
    const connectedAddress = wallet?.address;
    const onAccountsChanged = (value: unknown) => {
      const nextAddress = Array.isArray(value) && typeof value[0] === "string" ? getAddress(value[0]) : undefined;
      if (connectedAddress && nextAddress?.toLowerCase() !== connectedAddress.toLowerCase()) {
        clearSensitiveMemory();
        setWallet(undefined);
        setStatus("Wallet account changed. Reconnect Wallet A before continuing.");
        return;
      }
      if (!nextAddress) setWallet(undefined);
    };
    const onChainChanged = (value: unknown) => {
      try {
        const chainId = Number(BigInt(String(value)));
        setWallet((current) => current ? { ...current, chainId } : current);
        signedAuthorization.current?.signature.fill(0);
        signedAuthorization.current = null;
        setSignedAction(undefined);
      } catch {
        clearSensitiveMemory();
        setWallet(undefined);
      }
    };
    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [wallet?.address, clearSensitiveMemory]);

  useEffect(() => () => clearSensitiveMemory(), [clearSensitiveMemory]);

  const hasWalletA = wallet?.address.toLowerCase() === WALLET_A.toLowerCase();
  const guardianActive = Boolean(snapshot && newGuardianPublicKey && snapshot.guardianKey.toLowerCase() === newGuardianPublicKey.toLowerCase());

  async function connectWallet(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const connected = await connectArcMainnetWallet();
      setWallet(connected);
      if (connected.address.toLowerCase() !== WALLET_A.toLowerCase()) {
        setStatus("Connected wallet is not Wallet A. Protected actions are disabled.");
      } else {
        setStatus("Wallet A connected on Arc Mainnet.");
      }
      await refreshState();
    } catch (cause) {
      setError(safeErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function importCurrentGuardian(): Promise<void> {
    setError(undefined);
    if (!seedInput.current) return;
    let seedText = seedInput.current.value;
    seedInput.current.value = "";
    try {
      if (!hasWalletA) throw new Error("Connect Wallet A on Arc Mainnet first.");
      const live = snapshot ?? await refreshState();
      const material = importGuardianSeed(seedText);
      seedText = "";
      if (material.publicKey.toLowerCase() !== live.guardianKey.toLowerCase()) {
        destroyGuardian(material);
        throw new Error("The imported seed does not match the deployed account's current guardian.");
      }
      destroyGuardian(oldGuardian.current);
      oldGuardian.current = material;
      setOldGuardianPublicKey(material.publicKey);
      setStatus("Current guardian matched the deployed key. Its secret remains in this tab's memory.");
    } catch (cause) {
      seedText = "";
      setError(safeErrorMessage(cause));
    }
  }

  async function importActiveGuardian(seedOverride?: string): Promise<void> {
    setError(undefined);
    if (!activeGuardianSeedInput.current && seedOverride === undefined) return;
    let seedText = seedOverride ?? activeGuardianSeedInput.current?.value ?? "";
    if (activeGuardianSeedInput.current) activeGuardianSeedInput.current.value = "";
    let activeMaterial: GuardianMaterial | null = null;
    let rotationMaterial: GuardianMaterial | null = null;
    try {
      if (!hasWalletA) throw new Error("Connect Wallet A on Arc Mainnet first.");
      const live = await refreshState();
      activeMaterial = importGuardianSeed(seedText);
      rotationMaterial = importGuardianSeed(seedText);
      if (
        activeMaterial.publicKey.toLowerCase() !== live.guardianKey.toLowerCase() ||
        rotationMaterial.publicKey.toLowerCase() !== live.guardianKey.toLowerCase()
      ) {
        throw new Error("The imported seed does not match the deployed account's current guardian.");
      }

      const activePublicKey = activeMaterial.publicKey;
      const rotationPublicKey = rotationMaterial.publicKey;
      destroyGuardian(newGuardian.current);
      destroyGuardian(oldGuardian.current);
      signedAuthorization.current?.signature.fill(0);
      signedAuthorization.current = null;
      newGuardian.current = activeMaterial;
      activeMaterial = null;
      oldGuardian.current = rotationMaterial;
      rotationMaterial = null;
      setNewGuardianPublicKey(activePublicKey);
      setOldGuardianPublicKey(rotationPublicKey);
      setSignedAction(undefined);
      setNegativeChecks([]);
      setStatus("Active guardian matched. Its secret remains only in this tab's memory.");
    } catch (cause) {
      setError(safeErrorMessage(cause));
    } finally {
      seedText = "";
      destroyGuardian(activeMaterial);
      destroyGuardian(rotationMaterial);
    }
  }

  async function importActiveGuardianFile(file: File): Promise<void> {
    let seedText = "";
    try {
      seedText = (await file.text()).trim();
      if (!seedText) throw new Error("The selected local guardian seed file is empty.");
      await importActiveGuardian(seedText);
    } catch (cause) {
      setError(safeErrorMessage(cause));
    } finally {
      seedText = "";
    }
  }
  function makeNewGuardian(): void {
    setError(undefined);
    try {
      if (!oldGuardian.current) throw new Error("Import and confirm the current guardian before generating its replacement.");
      const material = generateGuardian();
      if (material.publicKey.toLowerCase() === oldGuardian.current.publicKey.toLowerCase()) {
        destroyGuardian(material);
        throw new Error("The generated guardian unexpectedly matches the current guardian.");
      }
      destroyGuardian(newGuardian.current);
      newGuardian.current = material;
      signedAuthorization.current?.signature.fill(0);
      signedAuthorization.current = null;
      setNewGuardianPublicKey(material.publicKey);
      setSignedAction(undefined);
      setNegativeChecks([]);
      setStatus("Fresh guardian generated in this tab. Only its public key is displayed.");
    } catch (cause) {
      setError(safeErrorMessage(cause));
    }
  }

  async function rotateGuardian(): Promise<void> {
    setBusy(true);
    setError(undefined);
    setNegativeChecks([]);
    try {
      const activeWallet = await requireOwnerWallet();
      const oldKey = oldGuardian.current;
      const nextKey = newGuardian.current;
      if (!oldKey || !nextKey) throw new Error("The current and replacement guardian must both be available in tab memory.");
      const live = await refreshState();
      if (live.guardianKey.toLowerCase() !== oldKey.publicKey.toLowerCase()) throw new Error("The deployed guardian changed; refusing to sign a stale rotation.");
      const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
      const deadline = latestBlock.timestamp + 900n;
      const subject = nextKey.publicKey;
      const payload = await getMatchingPayload(AuthorizationAction.ChangeGuardian, subject, 0n, live.nonce, deadline);
      const signature = signMessage(oldKey.secretKey, payload);
      if (!verifyMessage(oldKey.publicKey, payload, signature)) {
        signature.fill(0);
        throw new Error("Local guardian signature self-check failed.");
      }
      const signatureHex = toHex(signature);
      signedAuthorization.current = { action: "rotation", payload, signature, nonce: live.nonce, deadline, subject, amount: 0n, publicKey: oldKey.publicKey };
      setSignedAction("Guardian rotation authorization is signed locally and ready for simulation.");

      const call = {
        address: Q2FA_ACCOUNT,
        abi: q2faAccountAbi,
        functionName: "changeGuardian" as const,
        args: [subject, deadline, signatureHex] as const,
        account: activeWallet.address,
      };
      const calldata = encodeFunctionData({ abi: q2faAccountAbi, functionName: "changeGuardian", args: [subject, deadline, signatureHex] });
      await publicClient.simulateContract(call);
      const gasEstimate = await publicClient.estimateContractGas(call);
      const projection = await projectFee(gasEstimate);
      const current = await refreshState();
      assertBudget("guardian rotation", projection, current.walletANativeBalance);
      if (current.nonce !== live.nonce || current.guardianKey.toLowerCase() !== oldKey.publicKey.toLowerCase()) {
        throw new Error("Onchain account state changed during review. Create a fresh rotation authorization.");
      }
      setStatus(`Rotation simulation passed. Projected maximum network fee: ${formatUnits(projection.projectedFee, 18)} USDC.`);
      const calldataBytes = (calldata.length - 2) / 2;
      const hash = await activeWallet.walletClient.writeContract({ ...call, gas: projection.gasLimit, chain: undefined });
      const tx = await waitForReceipt("Guardian rotation", hash, projection, calldataBytes);
      if (tx.status !== "success") throw new Error("Guardian rotation transaction reverted.");
      const after = await refreshState();
      if (after.guardianKey.toLowerCase() !== nextKey.publicKey.toLowerCase() || after.nonce !== live.nonce + 1n) {
        throw new Error("Rotation receipt succeeded but the expected guardian or nonce was not observed onchain.");
      }
      destroyGuardian(oldGuardian.current);
      oldGuardian.current = null;
      setOldGuardianPublicKey(undefined);
      signedAuthorization.current?.signature.fill(0);
      signedAuthorization.current = null;
      setSignedAction(undefined);
      setStatus(`Guardian rotation confirmed in block ${tx.block}. The new guardian is active.`);
    } catch (cause) {
      setError(safeErrorMessage(cause));
      setStatus("Rotation stopped before further action. Refresh the account state before retrying.");
    } finally {
      setBusy(false);
    }
  }

  async function depositMinimum(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const activeWallet = await requireOwnerWallet();
      const live = await refreshState();
      if (live.accountUsdc > 0n) throw new Error("The account already holds USDC; no deposit is needed for the one-unit demo withdrawal.");
      if (live.walletAUsdc < demoAmount) throw new Error("Wallet A does not hold the minimum one base unit of Arc USDC.");
      const call = {
        address: ARC_USDC,
        abi: arcUsdcAbi,
        functionName: "transfer" as const,
        args: [Q2FA_ACCOUNT, demoAmount] as const,
        account: activeWallet.address,
      };
      const calldata = encodeFunctionData({ abi: arcUsdcAbi, functionName: "transfer", args: [Q2FA_ACCOUNT, demoAmount] });
      const simulation = await publicClient.simulateContract(call);
      if (!simulation.result) throw new Error("Arc USDC rejected the minimum deposit simulation.");
      const gasEstimate = await publicClient.estimateContractGas(call);
      const projection = await projectFee(gasEstimate);
      const latest = await refreshState();
      assertBudget("minimum USDC deposit", projection, latest.walletANativeBalance);
      if (latest.accountUsdc !== 0n || latest.walletAUsdc < demoAmount) throw new Error("Balances changed during review; refusing the deposit.");
      setStatus(`Deposit simulation passed. Sending 0.000001 USDC; projected maximum network fee: ${formatUnits(projection.projectedFee, 18)} USDC.`);
      const hash = await activeWallet.walletClient.writeContract({ ...call, gas: projection.gasLimit, chain: undefined });
      const tx = await waitForReceipt("Minimum USDC deposit", hash, projection, (calldata.length - 2) / 2);
      if (tx.status !== "success") throw new Error("Minimum USDC deposit reverted.");
      const after = await refreshState();
      if (after.accountUsdc < demoAmount) throw new Error("Deposit receipt succeeded but the account balance did not increase as expected.");
      setStatus(`Minimum deposit confirmed in block ${tx.block}.`);
    } catch (cause) {
      setError(safeErrorMessage(cause));
      setStatus("Deposit stopped. Refresh balances before retrying.");
    } finally {
      setBusy(false);
    }
  }

  async function signWithdrawal(): Promise<void> {
    setBusy(true);
    setError(undefined);
    setNegativeChecks([]);
    try {
      await requireOwnerWallet();
      const guardian = newGuardian.current;
      if (!guardian || !guardianActive) throw new Error("The new client guardian is not active on the deployed account.");
      const live = await refreshState();
      if (live.accountUsdc < demoAmount) throw new Error("Deposit the minimum USDC amount before preparing the withdrawal.");
      if (live.guardianKey.toLowerCase() !== guardian.publicKey.toLowerCase()) throw new Error("The account guardian no longer matches the client-held key.");
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const deadline = block.timestamp + 900n;
      const subject = addressSubject(WALLET_B);
      const payload = await getMatchingPayload(AuthorizationAction.Withdraw, subject, demoAmount, live.nonce, deadline);
      const signature = signMessage(guardian.secretKey, payload);
      if (!verifyMessage(guardian.publicKey, payload, signature)) {
        signature.fill(0);
        throw new Error("Local withdrawal signature self-check failed.");
      }
      signedAuthorization.current?.signature.fill(0);
      signedAuthorization.current = { action: "withdrawal", payload, signature, nonce: live.nonce, deadline, subject, amount: demoAmount, publicKey: guardian.publicKey };
      setSignedAction("Withdrawal signed locally. Read-only authorization checks are running.");
      const results = await simulateWithdrawalNegatives(signedAuthorization.current);
      const afterSimulations = await refreshState();
      if (
        afterSimulations.nonce !== live.nonce ||
        afterSimulations.guardianKey.toLowerCase() !== guardian.publicKey.toLowerCase() ||
        afterSimulations.accountUsdc !== live.accountUsdc
      ) {
        throw new Error("The read-only simulations changed observed account state. Submission remains disabled.");
      }
      setNegativeChecks(results);
      setStatus("Valid withdrawal simulation and all negative authorization checks passed. Review below, then submit with Wallet A.");
    } catch (cause) {
      signedAuthorization.current?.signature.fill(0);
      signedAuthorization.current = null;
      setSignedAction(undefined);
      setError(safeErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submitWithdrawal(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const activeWallet = await requireOwnerWallet();
      const authorization = signedAuthorization.current;
      const guardian = newGuardian.current;
      if (!authorization || authorization.action !== "withdrawal" || !guardian) throw new Error("Sign the withdrawal authorization first.");
      if (authorization.publicKey.toLowerCase() !== guardian.publicKey.toLowerCase()) throw new Error("The prepared signature is not from the active guardian.");
      const live = await refreshState();
      if (live.guardianKey.toLowerCase() !== guardian.publicKey.toLowerCase()) throw new Error("The deployed guardian changed; refusing to submit.");
      if (live.nonce !== authorization.nonce) throw new Error("The account nonce changed; prepare a new withdrawal signature.");
      if (live.accountUsdc < authorization.amount) throw new Error("The account balance is below the signed withdrawal amount.");
      const [beforeWalletB, block] = await Promise.all([
        publicClient.readContract({ address: ARC_USDC, abi: arcUsdcAbi, functionName: "balanceOf", args: [WALLET_B] }),
        publicClient.getBlock({ blockTag: "latest" }),
      ]);
      if (authorization.deadline < block.timestamp) throw new Error("The authorization expired; create a fresh signature.");
      const signatureHex = toHex(authorization.signature);
      const call = {
        address: Q2FA_ACCOUNT,
        abi: q2faAccountAbi,
        functionName: "withdraw" as const,
        args: [WALLET_B, authorization.amount, authorization.deadline, signatureHex] as const,
        account: activeWallet.address,
      };
      const calldata = encodeFunctionData({ abi: q2faAccountAbi, functionName: "withdraw", args: [WALLET_B, authorization.amount, authorization.deadline, signatureHex] });
      await publicClient.simulateContract(call);
      const gasEstimate = await publicClient.estimateContractGas(call);
      const projection = await projectFee(gasEstimate);
      const latest = await refreshState();
      assertBudget("protected withdrawal", projection, latest.walletANativeBalance);
      if (latest.nonce !== authorization.nonce || latest.guardianKey.toLowerCase() !== guardian.publicKey.toLowerCase()) {
        throw new Error("Account state changed during review; create a fresh authorization.");
      }
      setStatus(`Simulation passed. Sending 0.000001 USDC to Wallet B; projected maximum network fee: ${formatUnits(projection.projectedFee, 18)} USDC.`);
      const hash = await activeWallet.walletClient.writeContract({ ...call, gas: projection.gasLimit, chain: undefined });
      const calldataBytes = (calldata.length - 2) / 2;
      const tx = await waitForReceipt("Protected withdrawal to Wallet B", hash, projection, calldataBytes);
      if (tx.status !== "success") throw new Error("Protected withdrawal transaction reverted.");
      const after = await refreshState();
      const afterWalletB = await publicClient.readContract({ address: ARC_USDC, abi: arcUsdcAbi, functionName: "balanceOf", args: [WALLET_B] });
      if (after.nonce !== authorization.nonce + 1n) throw new Error("Withdrawal succeeded but the account nonce did not advance exactly once.");
      if (afterWalletB - beforeWalletB !== authorization.amount) throw new Error("Withdrawal succeeded but Wallet B's Arc USDC balance delta did not match the signed amount.");
      authorization.signature.fill(0);
      signedAuthorization.current = null;
      setSignedAction(undefined);
      setStatus(`Withdrawal confirmed. Wallet B received ${formatUnits(authorization.amount, after.usdcDecimals)} USDC; nonce advanced ${authorization.nonce} → ${after.nonce}.`);
    } catch (cause) {
      setError(safeErrorMessage(cause));
      setStatus("Withdrawal stopped. Check the current account nonce and balances before retrying.");
    } finally {
      setBusy(false);
    }
  }

  async function requireOwnerWallet(): Promise<ConnectedWallet> {
    if (!wallet) throw new Error("Connect Wallet A first.");
    const provider = window.ethereum;
    if (!provider) throw new Error("The injected wallet is no longer available.");
    const chainId = Number(BigInt(String(await provider.request({ method: "eth_chainId" }))));
    if (chainId !== ARC_CHAIN_ID) throw new Error("Switch the connected wallet to Arc Mainnet (5042).");
    if (wallet.address.toLowerCase() !== WALLET_A.toLowerCase()) throw new Error("Only Wallet A can submit protected actions.");
    const [owner, liveChainId] = await Promise.all([
      publicClient.readContract({ address: Q2FA_ACCOUNT, abi: q2faAccountAbi, functionName: "owner" }),
      publicClient.getChainId(),
    ]);
    if (liveChainId !== ARC_CHAIN_ID || owner.toLowerCase() !== WALLET_A.toLowerCase()) {
      throw new Error("Live Arc state does not match the configured chain and Wallet A owner.");
    }
    return wallet;
  }

  async function getMatchingPayload(action: 0 | 1 | 2, subject: Hex, amount: bigint, nonce: bigint, deadline: bigint): Promise<Hex> {
    const clientPayload = encodeAuthorizationPayload({
      chainId: ARC_CHAIN_ID,
      account: Q2FA_ACCOUNT,
      action,
      subject,
      amount,
      nonce,
      deadline,
    });
    const contractPayload = await publicClient.readContract({
      address: Q2FA_ACCOUNT,
      abi: q2faAccountAbi,
      functionName: "authorizationPayload",
      args: [action, subject, amount, deadline],
    });
    if (contractPayload.toLowerCase() !== clientPayload.toLowerCase()) {
      throw new Error("Client authorization bytes differ from the deployed contract's payload.");
    }
    return clientPayload;
  }

  async function projectFee(gasEstimate: bigint): Promise<FeeProjection> {
    const fees = await publicClient.estimateFeesPerGas();
    const pricePerGas = ("maxFeePerGas" in fees ? fees.maxFeePerGas : undefined)
      ?? ("gasPrice" in fees ? fees.gasPrice : undefined);
    if (!pricePerGas || pricePerGas <= 0n) throw new Error("Arc RPC did not return usable gas-price information.");
    const gasLimit = gasEstimate + (gasEstimate + 3n) / 4n;
    return { gasLimit, pricePerGas, projectedFee: gasLimit * pricePerGas };
  }

  function assertBudget(action: string, projection: FeeProjection, nativeBalance: bigint): void {
    if (phase2Fees + projection.projectedFee > phase2FeeLimit) {
      throw new Error(`${action} projected fee would exceed the Phase 2 network-fee cap of 0.05 USDC; no transaction was sent.`);
    }
    if (nativeBalance < projection.projectedFee) {
      throw new Error(`${action} projected maximum fee exceeds Wallet A's current native USDC balance; no transaction was sent.`);
    }
  }

  async function expectRevert(label: string, expectedName: string, operation: () => Promise<unknown>): Promise<string> {
    let failure: unknown;
    try {
      await operation();
    } catch (cause) {
      failure = cause;
    }
    if (!failure) throw new Error(`Negative simulation unexpectedly succeeded: ${label}.`);
    const actualName = extractContractErrorName(failure, q2faAccountAbi);
    if (actualName !== expectedName) {
      const diagnostic = describeViemError(failure, q2faAccountAbi);
      throw new Error(`Negative simulation ${label} reverted with ${actualName ?? "an undecoded error"}, expected ${expectedName}. Viem diagnostic: ${JSON.stringify(diagnostic)}`);
    }
    return `${label}: reverted with ${expectedName}`;
  }

  async function waitForReceipt(label: string, hash: Hex, projection: FeeProjection, calldataBytes: number): Promise<TransactionRecord> {
    setStatus(`${label} submitted. Waiting for the Arc Mainnet receipt…`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
    const gasPrice = receipt.effectiveGasPrice ?? projection.pricePerGas;
    const fee = receipt.gasUsed * gasPrice;
    const record: TransactionRecord = {
      label,
      hash,
      block: receipt.blockNumber.toString(),
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      gasPrice: gasPrice.toString(),
      fee,
      calldataBytes,
    };
    setTransactions((current) => [...current, record]);
    setPhase2Fees((current) => current + fee);
    return record;
  }

  async function simulateWithdrawalNegatives(authorization: SignedAuthorization): Promise<string[]> {
    const signatureHex = toHex(authorization.signature);
    const base = {
      address: Q2FA_ACCOUNT,
      abi: q2faAccountAbi,
      functionName: "withdraw" as const,
      args: [WALLET_B, authorization.amount, authorization.deadline, signatureHex] as const,
      account: WALLET_A,
    };
    await publicClient.simulateContract(base);
    const checks: string[] = ["Valid signature: simulation succeeded"];

    const changedRecipient = await expectRevert("changed recipient", "InvalidPQSignature", () => publicClient.simulateContract({
      ...base,
      args: [WALLET_A, authorization.amount, authorization.deadline, signatureHex],
    }));
    checks.push(changedRecipient);

    const changedAmount = await expectRevert("changed amount", "InvalidPQSignature", () => publicClient.simulateContract({
      ...base,
      args: [WALLET_B, authorization.amount + 1n, authorization.deadline, signatureHex],
    }));
    checks.push(changedAmount);

    const postUseNonce = authorization.nonce + 1n;
    checks.push(await expectRevert("stale nonce after nonce advance", "InvalidPQSignature", () => publicClient.simulateContract({
      ...base,
      stateOverride: [{
        address: Q2FA_ACCOUNT,
        stateDiff: [{ slot: toHex(2n, { size: 32 }), value: toHex(postUseNonce, { size: 32 }) }],
      }],
    })));

    const block = await publicClient.getBlock({ blockTag: "latest" });
    const expiredDeadline = block.timestamp - 1n;
    const expiredPayload = await getMatchingPayload(AuthorizationAction.Withdraw, authorization.subject, authorization.amount, authorization.nonce, expiredDeadline);
    const expiredSignature = signMessage(newGuardian.current!.secretKey, expiredPayload);
    try {
      checks.push(await expectRevert("expired authorization", "AuthorizationExpired", () => publicClient.simulateContract({
        ...base,
        args: [WALLET_B, authorization.amount, expiredDeadline, toHex(expiredSignature)],
      })));
    } finally {
      expiredSignature.fill(0);
    }

    checks.push(await expectRevert("non-owner sender", "NotOwner", () => publicClient.simulateContract({
      ...base,
      account: WALLET_B,
    })));

    const corrupted = Uint8Array.from(authorization.signature);
    corrupted[0] ^= 1;
    try {
      checks.push(await expectRevert("corrupted signature", "InvalidPQSignature", () => publicClient.simulateContract({
        ...base,
        args: [WALLET_B, authorization.amount, authorization.deadline, toHex(corrupted)],
      })));
    } finally {
      corrupted.fill(0);
    }

    const wrongAction = await getMatchingPayload(AuthorizationAction.Withdraw, authorization.subject, authorization.amount, authorization.nonce, authorization.deadline);
    if (wrongAction !== authorization.payload) throw new Error("Withdrawal payload changed unexpectedly during negative checks.");
    checks.push(await expectRevert("changed action", "InvalidPQSignature", () => publicClient.simulateContract({
      address: Q2FA_ACCOUNT,
      abi: q2faAccountAbi,
      functionName: "changeGuardian",
      args: [authorization.publicKey, authorization.deadline, signatureHex],
      account: WALLET_A,
    })));
    return checks;
  }

  function importSeedKeyLabel(): string {
    return oldGuardianPublicKey ? "Current guardian matched" : "No current guardian imported";
  }

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Q2FA · Phase 2</p>
          <h1>Guardian client</h1>
          <p className="lede">Generate and use an SLH-DSA guardian in this browser tab, then submit with Wallet A on Arc Mainnet.</p>
        </div>
        <button type="button" onClick={() => void connectWallet()} disabled={busy}>
          {wallet ? "Reconnect wallet" : "Connect Wallet A"}
        </button>
      </header>

      <aside className="security-note" role="note">
        <strong>Guardian secrets stay in tab memory.</strong> This client does not send them to an API or write them to browser storage. After a reload, restore the deployed guardian with its 48-byte seed in the withdrawal panel.
      </aside>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Arc Mainnet</p><h2>Deployed account</h2></div><button className="secondary" type="button" onClick={() => void refreshState().then(() => setStatus("Onchain state refreshed.")).catch((cause: unknown) => setError(safeErrorMessage(cause)))} disabled={busy}>Refresh state</button></div>
        <dl className="state-grid">
          <div><dt>Network</dt><dd>Arc Mainnet · 5042</dd></div>
          <div><dt>Connected wallet</dt><dd>{wallet?.address ?? "Not connected"}{wallet && ` · chain ${wallet.chainId}`}</dd></div>
          <div><dt>Owner</dt><dd>{snapshot?.owner ?? "Reading…"}{snapshot && snapshot.owner.toLowerCase() !== WALLET_A.toLowerCase() && <span className="warning"> · differs from Wallet A</span>}</dd></div>
          <div><dt>Q2FA account</dt><dd>{Q2FA_ACCOUNT}</dd></div>
          <div><dt>Guardian public key</dt><dd className="mono break">{snapshot?.guardianKey ?? "Reading…"}</dd></div>
          <div><dt>Nonce</dt><dd>{snapshot?.nonce.toString() ?? "—"}</dd></div>
          <div><dt>Account USDC</dt><dd>{snapshot ? `${formatUnits(snapshot.accountUsdc, snapshot.usdcDecimals)} USDC` : "Reading…"}</dd></div>
          <div><dt>Wallet A USDC</dt><dd>{snapshot ? `${formatUnits(snapshot.walletAUsdc, snapshot.usdcDecimals)} USDC` : "Reading…"}</dd></div>
          <div><dt>Wallet A native gas balance</dt><dd>{snapshot ? `${formatUnits(snapshot.walletANativeBalance, 18)} USDC` : "Reading…"}</dd></div>
          <div><dt>Wallet B USDC</dt><dd>{snapshot ? `${formatUnits(snapshot.walletBUsdc, snapshot.usdcDecimals)} USDC` : "Reading…"}</dd></div>
        </dl>
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Two-factor setup</p><h2>Rotate to a fresh guardian</h2></div><span className={guardianActive ? "badge active" : "badge"}>{guardianActive ? "Active onchain" : "Not active"}</span></div>
        <p className="body-copy">The currently deployed guardian must authorize installation of its replacement. Import the current guardian here to start a rotation; after a reload, restore the active guardian in the withdrawal panel. Never enter an EVM wallet key here.</p>
        <div className="action-row">
          <label className="input-wrap">Current guardian seed
            <input ref={seedInput} type="password" autoComplete="off" spellCheck={false} placeholder="48-byte hex seed" disabled={busy || !hasWalletA || guardianActive} />
          </label>
          <button type="button" className="secondary" onClick={() => void importCurrentGuardian()} disabled={busy || !hasWalletA || guardianActive}>Import and match</button>
        </div>
        <p className="muted">{importSeedKeyLabel()}{oldGuardianPublicKey && <span className="mono break"> · {oldGuardianPublicKey}</span>}</p>
        <div className="action-row">
          <button type="button" className="secondary" onClick={makeNewGuardian} disabled={busy || !oldGuardian.current}>Generate fresh guardian</button>
          <button type="button" onClick={() => void rotateGuardian()} disabled={busy || !hasWalletA || !oldGuardian.current || !newGuardian.current || guardianActive}>Sign, simulate, and rotate</button>
        </div>
        {newGuardianPublicKey && <p className="key-display"><span className="label">New guardian public key</span><code className="mono break">{newGuardianPublicKey}</code><span className="muted">Private key is held only in this tab's memory.</span></p>}
        {snapshot && newGuardianPublicKey && <p className="muted">Onchain status: {snapshot.guardianKey.toLowerCase() === newGuardianPublicKey.toLowerCase() ? "active" : "not active"}</p>}
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Tiny end-to-end demo</p><h2>Withdraw to Wallet B</h2></div><span className="badge">1 base unit</span></div>
        <p className="body-copy">After a reload, enter the 48-byte seed for the deployed guardian. The client checks the derived key against the onchain guardian and keeps it only in this tab's memory.</p>
        <div className="action-row">
          <label className="input-wrap">Active guardian seed
            <input ref={activeGuardianSeedInput} type="password" autoComplete="off" spellCheck={false} placeholder="48-byte hex seed" disabled={busy || !hasWalletA || guardianActive} />
          </label>
          <button type="button" className="secondary" onClick={() => void importActiveGuardian()} disabled={busy || !hasWalletA || guardianActive}>Restore and match</button>
        </div>
        <label className="input-wrap">Restore from local seed backup
          <input
            type="file"
            accept=".hex,text/plain"
            disabled={busy || !hasWalletA || guardianActive}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void importActiveGuardianFile(file);
            }}
          />
        </label>
        <p className="muted">The selected file is read in this tab and is not uploaded or stored by the client.</p>
        <p className="muted">{guardianActive ? "Guardian available and matched to the deployed account." : "No active guardian restored in this tab."}</p>        <div className="action-summary">
          <p><strong>Recipient</strong><code className="mono">{WALLET_B}</code></p>
          <p><strong>Amount</strong><span>0.000001 USDC</span></p>
          <p><strong>Required approval</strong><span>Active PQ guardian + Wallet A</span></p>
          <p><strong>Nonce</strong><span>{snapshot?.nonce.toString() ?? "Read from chain before signing"}</span></p>
        </div>
        {snapshot && snapshot.accountUsdc === 0n && <div className="deposit-callout"><span>Account balance is zero. Deposit exactly 0.000001 USDC from Wallet A before withdrawal.</span><button className="secondary" type="button" onClick={() => void depositMinimum()} disabled={busy || !hasWalletA || !guardianActive || snapshot.walletAUsdc < demoAmount}>Deposit minimum</button></div>}
        {snapshot && snapshot.accountUsdc > 0n && snapshot.accountUsdc < demoAmount && <p className="warning">Account balance is below the demo withdrawal amount.</p>}
        <div className="action-row">
          <button type="button" className="secondary" onClick={() => void signWithdrawal()} disabled={busy || !hasWalletA || !guardianActive || (snapshot?.accountUsdc ?? 0n) < demoAmount}>Sign and simulate withdrawal</button>
          <button type="button" onClick={() => void submitWithdrawal()} disabled={busy || !hasWalletA || !guardianActive || !signedAuthorization.current || negativeChecks.length < 7}>Submit with Wallet A</button>
        </div>
        {signedAction && <p className="status-line">{signedAction}</p>}
        {negativeChecks.length > 0 && <ul className="check-list">{negativeChecks.map((check) => <li key={check}>{check}</li>)}</ul>}
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Network fee guard</p><h2>Phase 2 transactions</h2></div><span className="badge">Cap: 0.05 USDC</span></div>
        <p className="body-copy">Measured network fees: <strong>{formatUnits(phase2Fees, 18)} USDC</strong>. Each transaction is simulated, gas-estimated, and checked against the remaining cap before the wallet is asked to submit it.</p>
        {transactions.length === 0 ? <p className="muted">No Phase 2 transaction has been sent from this tab.</p> : <ol className="transaction-list">{transactions.map((tx) => <li key={tx.hash}>
          <div><strong>{tx.label}</strong><span className="muted">Block {tx.block} · {tx.status}</span></div>
          <a href={`${explorerBase}${tx.hash}`} target="_blank" rel="noreferrer">{tx.hash}</a>
          <span className="muted">Gas {tx.gasUsed} · {tx.gasPrice} wei · fee {formatUnits(tx.fee, 18)} USDC · calldata {tx.calldataBytes} bytes</span>
        </li>)}</ol>}
      </section>

      <footer className="footer" aria-live="polite">
        <span>{status}</span>
        {error && <span className="error" role="alert">{error}</span>}
      </footer>
    </main>
  );

}

function safeErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "shortMessage" in error && typeof error.shortMessage === "string") {
    return error.shortMessage;
  }
  if (error instanceof Error) return error.message;
  return "The operation failed. Check the wallet prompt and current Arc Mainnet state.";
}
