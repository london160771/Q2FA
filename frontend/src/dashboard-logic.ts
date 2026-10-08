import {
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import {
  ARC_CHAIN_ID,
  AuthorizationAction,
  encodeAuthorizationPayload,
  type AuthorizationPayloadInput,
} from "@q2fa/shared";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_GUARDIAN = `0x${"00".repeat(32)}`;

export interface SecurityOverviewState {
  owner: Address;
  guardianKey: Hex;
  nonce: bigint;
  protectedBalance: bigint;
  usdcDecimals: number;
}

export interface ActivityEntry {
  id: string;
  action: "Deposit" | "Protected withdrawal" | "Owner changed" | "Guardian changed";
  amount?: bigint;
  address?: Address;
  addressLabel?: string;
  blockNumber: bigint;
  timestamp?: bigint;
  transactionHash: Hex;
  networkFee?: bigint;
}

export interface SendRequest {
  recipient: Address;
  amount: bigint;
}

export function guardianMatchesOnchain(derivedKey: Hex, activeKey: Hex): boolean {
  return derivedKey.toLowerCase() === activeKey.toLowerCase();
}

export function isOnchainGuardianActive(guardianKey: Hex): boolean {
  return guardianKey.toLowerCase() !== ZERO_GUARDIAN;
}

export function validateSendRequest(
  recipientText: string,
  amountText: string,
  protectedBalance: bigint,
  decimals = 6,
): SendRequest {
  const candidate = recipientText.trim();
  if (!isAddress(candidate, { strict: false })) {
    throw new Error("Enter a valid EVM recipient address.");
  }
  const recipient = getAddress(candidate);
  if (recipient.toLowerCase() === ZERO_ADDRESS) {
    throw new Error("The zero address cannot receive protected USDC.");
  }

  const amountValue = amountText.trim();
  if (!amountValue || !/^\d+(?:\.\d+)?$/.test(amountValue)) {
    throw new Error("Enter a USDC amount using digits and an optional decimal point.");
  }
  const fractionalDigits = amountValue.split(".")[1]?.length ?? 0;
  if (fractionalDigits > decimals) {
    throw new Error(`Arc USDC supports up to ${decimals} decimal places.`);
  }

  const amount = parseUnits(amountValue, decimals);
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
  if (amount > protectedBalance) throw new Error("The amount exceeds the protected USDC balance.");
  return { recipient, amount };
}

export function buildWithdrawalPayload(input: Omit<AuthorizationPayloadInput, "action">): Hex {
  return encodeAuthorizationPayload({ ...input, action: AuthorizationAction.Withdraw });
}

export interface SubmitRequirements {
  connectedAddress?: Address;
  accountOwner: Address;
  walletChainId?: number;
  rpcChainId: number;
  guardianMatched: boolean;
  simulationPassed: boolean;
}

export function canSubmitProtectedAction(requirements: SubmitRequirements): boolean {
  return Boolean(
    requirements.connectedAddress &&
    requirements.connectedAddress.toLowerCase() === requirements.accountOwner.toLowerCase() &&
    requirements.accountOwner.toLowerCase() !== ZERO_ADDRESS &&
    requirements.walletChainId === ARC_CHAIN_ID &&
    requirements.rpcChainId === ARC_CHAIN_ID &&
    requirements.guardianMatched &&
    requirements.simulationPassed,
  );
}

export interface SecurityDemoOutcome {
  walletOnly: "blocked";
  walletOnlyReason: string;
  twoFactor: "authorized";
  twoFactorAction: string;
}

export interface WalletOnlyDemoOutcome {
  walletOnly: "blocked";
  walletOnlyReason: string;
  revertName: "InvalidPQSignatureLength" | "InvalidPQSignature";
}

/** Verifies an actual read-only owner-only call failed specifically at PQ authorization. */
export async function verifyWalletOnlyBlocked(
  simulateWalletOnly: () => Promise<unknown>,
  errorName: (error: unknown) => string | undefined,
): Promise<WalletOnlyDemoOutcome> {
  let walletOnlyFailure: unknown;
  try {
    await simulateWalletOnly();
  } catch (error) {
    walletOnlyFailure = error;
  }
  if (!walletOnlyFailure) {
    throw new Error("The owner-only withdrawal simulation unexpectedly succeeded.");
  }

  const revertName = errorName(walletOnlyFailure);
  if (revertName !== "InvalidPQSignatureLength" && revertName !== "InvalidPQSignature") {
    throw new Error(`The owner-only simulation had an unexpected result${revertName ? ` (${revertName})` : ""}.`);
  }
  return {
    walletOnly: "blocked",
    walletOnlyReason: revertName === "InvalidPQSignatureLength" ? "PQ authorization missing" : "PQ authorization invalid",
    revertName,
  };
}

/** Runs the real read-only simulations supplied by the caller and rejects unexpected outcomes. */
export async function runSecurityDemo(
  simulateWalletOnly: () => Promise<unknown>,
  simulateWithBothFactors: () => Promise<unknown>,
  errorName: (error: unknown) => string | undefined,
  actionDescription: string,
): Promise<SecurityDemoOutcome> {
  const walletOnly = await verifyWalletOnlyBlocked(simulateWalletOnly, errorName);
  await simulateWithBothFactors();
  return {
    walletOnly: "blocked",
    walletOnlyReason: walletOnly.walletOnlyReason,
    twoFactor: "authorized",
    twoFactorAction: actionDescription,
  };
}

export function formatUsdc(amount: bigint, decimals = 6): string {
  return `${formatUnits(amount, decimals)} USDC`;
}

export function shortenAddress(value: string, prefix = 8, suffix = 6): string {
  if (value.length <= prefix + suffix + 3) return value;
  return `${value.slice(0, prefix)}…${value.slice(-suffix)}`;
}

export function sortActivityNewestFirst(items: ActivityEntry[]): ActivityEntry[] {
  return [...items].sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) return left.blockNumber > right.blockNumber ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
}
