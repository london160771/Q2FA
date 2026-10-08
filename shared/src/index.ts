import { defineChain, pad, toBytes, toHex, type Address, type Hex } from "viem";

export const ARC_CHAIN_ID = 5042;
export const ARC_RPC_URL = "https://rpc.mainnet.arc.io";
export const ARC_PQ_VERIFIER = "0x1800000000000000000000000000000000000004" as Address;
export const ARC_USDC = "0x3600000000000000000000000000000000000000" as Address;
export const Q2FA_ACCOUNT = "0xa40524d1e9380d3b82752ec4bc074cc7e6272fb0" as Address;
export const WALLET_A = "0x90e3a58694e953f5eC4018fF7dd57BE036f11FcE" as Address;
export const WALLET_B = "0x815C2fb8178F0bf80aDa8C5B97fF44Ece90e6e25" as Address;
export const PQ_PUBLIC_KEY_BYTES = 32;
export const PQ_SIGNATURE_BYTES = 7_856;

export const arcMainnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
});

export const AUTHORIZATION_SCHEMA = pad(toHex(toBytes("Q2FA_AUTH_V1")), { size: 32, dir: "right" });

export const AuthorizationAction = {
  Withdraw: 0,
  ChangeOwner: 1,
  ChangeGuardian: 2,
} as const;

export type AuthorizationAction = (typeof AuthorizationAction)[keyof typeof AuthorizationAction];

export interface AuthorizationPayloadInput {
  chainId: bigint | number;
  account: Address;
  action: AuthorizationAction;
  subject: Hex;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
}

/** ABI-encode the exact 256-byte message signed by SLH-DSA. */
export function encodeAuthorizationPayload(input: AuthorizationPayloadInput): Hex {
  const { chainId, account, action, subject, amount, nonce, deadline } = input;
  if (subject.length !== 66) throw new Error("Authorization subject must be exactly 32 bytes");
  if (!Object.values(AuthorizationAction).includes(action)) throw new Error("Unknown Q2FA action");

  return toHex(encodeStaticWords([
    AUTHORIZATION_SCHEMA,
    wordUint(BigInt(chainId)),
    wordAddress(account),
    wordUint(BigInt(action)),
    subject,
    wordUint(amount),
    wordUint(nonce),
    wordUint(deadline),
  ]));
}

/** Addresses occupy the low 20 bytes of the bytes32 subject word. */
export function addressSubject(address: Address): Hex {
  return pad(address, { size: 32, dir: "left" });
}

function encodeStaticWords(words: readonly Hex[]): Uint8Array {
  const output = new Uint8Array(words.length * 32);
  words.forEach((word, index) => output.set(toBytes(word), index * 32));
  return output;
}

function wordUint(value: bigint): Hex {
  if (value < 0n || value >= 1n << 256n) throw new Error("ABI uint256 value out of range");
  return pad(toHex(value), { size: 32, dir: "left" });
}

function wordAddress(address: Address): Hex {
  return pad(address, { size: 32, dir: "left" });
}
