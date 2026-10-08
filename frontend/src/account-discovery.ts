import type { Address } from "viem";

export type AccountDiscoveryResult =
  | { status: "disconnected" }
  | { status: "create"; owner: Address }
  | { status: "load"; owner: Address; account: Address };

/** Classifies the factory lookup result; a demo account is never a fallback. */
export function resolveAccountForOwner(owner?: Address, factoryAccount?: Address): AccountDiscoveryResult {
  if (!owner) return { status: "disconnected" };
  if (!factoryAccount || /^0x0{40}$/i.test(factoryAccount)) return { status: "create", owner };
  return { status: "load", owner, account: factoryAccount };
}

export function accountOwnerMatches(connectedOwner: Address, liveOwner: Address): boolean {
  return connectedOwner.toLowerCase() === liveOwner.toLowerCase();
}

export function accountIsSubmittable(input: {
  connectedOwner?: Address;
  liveOwner?: Address;
  discoveredAccount?: Address;
  submittedAccount?: Address;
}): boolean {
  return Boolean(
    input.connectedOwner && input.liveOwner && input.discoveredAccount && input.submittedAccount &&
    accountOwnerMatches(input.connectedOwner, input.liveOwner) &&
    input.discoveredAccount.toLowerCase() === input.submittedAccount.toLowerCase(),
  );
}

export function buildAccountTargets(account: Address): { withdrawal: Address; deposit: Address; activity: Address } {
  return { withdrawal: account, deposit: account, activity: account };
}
