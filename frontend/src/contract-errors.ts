import { decodeErrorResult, type Abi, type Hex } from "viem";

interface ErrorLike {
  cause?: unknown;
  data?: unknown;
  errorName?: unknown;
  name?: unknown;
  raw?: unknown;
  revertData?: unknown;
  shortMessage?: unknown;
  signature?: unknown;
}

export interface ViemErrorDiagnostic {
  chain: Array<{
    type: string;
    name?: string;
    shortMessage?: string;
    errorName?: string;
    revertData?: Hex;
    errorSignature?: string;
  }>;
}

const HEX_RE = /^0x(?:[0-9a-fA-F]{8,})$/;

/**
 * Finds a decoded custom error without skipping intermediate viem causes.
 * BaseError.walk() with no predicate returns the deepest cause, which can skip
 * ContractFunctionRevertedError.data entirely.
 */
export function extractContractErrorName(error: unknown, abi: Abi): string | undefined {
  for (const node of causeChain(error)) {
    const candidate = node as ErrorLike;
    const data = candidate.data;
    if (data && typeof data === "object" && "errorName" in data) {
      const errorName = (data as { errorName?: unknown }).errorName;
      if (typeof errorName === "string") return errorName;
    }
    if (typeof candidate.errorName === "string") return candidate.errorName;

    for (const raw of getRevertDataCandidates(candidate)) {
      try {
        return decodeErrorResult({ abi, data: raw }).errorName;
      } catch {
        // Continue through the cause chain when data is not an ABI custom error.
      }
    }
  }
  return undefined;
}

/** A safe, bounded summary: it excludes call arguments and request bodies. */
export function describeViemError(error: unknown, abi: Abi): ViemErrorDiagnostic {
  const chain: ViemErrorDiagnostic["chain"] = [];
  for (const node of causeChain(error)) {
    const candidate = node as ErrorLike;
    const data = candidate.data;
    const revertData = getRevertDataCandidates(candidate)[0];
    let errorName = decodedName(data);
    if (!errorName && revertData) {
      try {
        errorName = decodeErrorResult({ abi, data: revertData }).errorName;
      } catch {
        // Preserve the raw revert bytes even when the ABI cannot decode them.
      }
    }
    const type = node && typeof node === "object" && "constructor" in node
      ? ((node as { constructor?: { name?: string } }).constructor?.name ?? "Object")
      : typeof node;
    const row: ViemErrorDiagnostic["chain"][number] = { type };
    if (typeof candidate.name === "string") row.name = candidate.name;
    if (typeof candidate.shortMessage === "string") row.shortMessage = candidate.shortMessage;
    if (errorName) row.errorName = errorName;
    if (revertData) row.revertData = revertData;
    if (typeof candidate.signature === "string" && candidate.signature.length <= 128) {
      row.errorSignature = candidate.signature;
    }
    chain.push(row);
  }
  return { chain };
}

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 12 && current && typeof current === "object" && !seen.has(current); depth += 1) {
    chain.push(current);
    seen.add(current);
    current = (current as ErrorLike).cause;
  }
  return chain;
}

function decodedName(data: unknown): string | undefined {
  if (data && typeof data === "object" && "errorName" in data) {
    const errorName = (data as { errorName?: unknown }).errorName;
    return typeof errorName === "string" ? errorName : undefined;
  }
  return undefined;
}

function getRevertDataCandidates(error: ErrorLike): Hex[] {
  const result: Hex[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && HEX_RE.test(value) && !result.includes(value as Hex)) {
      result.push(value as Hex);
    }
  };
  add(error.data);
  add(error.raw);
  add(error.revertData);
  if (error.data && typeof error.data === "object") {
    const data = error.data as Record<string, unknown>;
    add(data.data);
    add(data.revertData);
    add(data.returnData);
  }
  return result;
}
