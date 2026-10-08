import { slh_dsa_sha2_128s } from "@noble/post-quantum/slh-dsa.js";
import { hexToBytes, toHex, type Hex } from "viem";
import { PQ_PUBLIC_KEY_BYTES, PQ_SIGNATURE_BYTES } from "@q2fa/shared";

export interface GuardianMaterial {
  publicKey: Hex;
  secretKey: Uint8Array;
}

export function generateGuardian(): GuardianMaterial {
  const pair = slh_dsa_sha2_128s.keygen();
  if (pair.publicKey.length !== PQ_PUBLIC_KEY_BYTES || pair.secretKey.length !== 64) {
    pair.secretKey.fill(0);
    throw new Error("SLH-DSA-SHA2-128s returned an unexpected key size");
  }
  return { publicKey: toHex(pair.publicKey), secretKey: pair.secretKey };
}

/** Imports a seed only into tab memory, then wipes the temporary seed buffer. */
export function importGuardianSeed(seedText: string): GuardianMaterial {
  const normalized = seedText.startsWith("0x") ? seedText.slice(2) : seedText;
  if (!/^[0-9a-fA-F]{96}$/.test(normalized)) {
    throw new Error("The current guardian seed must be exactly 48 bytes of hexadecimal data");
  }

  const seed = hexToBytes(`0x${normalized}`);
  try {
    const pair = slh_dsa_sha2_128s.keygen(seed);
    if (pair.publicKey.length !== PQ_PUBLIC_KEY_BYTES || pair.secretKey.length !== 64) {
      pair.secretKey.fill(0);
      throw new Error("SLH-DSA-SHA2-128s returned an unexpected key size");
    }
    return { publicKey: toHex(pair.publicKey), secretKey: pair.secretKey };
  } finally {
    seed.fill(0);
  }
}

export function signMessage(secretKey: Uint8Array, message: Hex): Uint8Array {
  const signature = slh_dsa_sha2_128s.sign(hexToBytes(message), secretKey);
  if (signature.length !== PQ_SIGNATURE_BYTES) {
    signature.fill(0);
    throw new Error("SLH-DSA-SHA2-128s returned an unexpected signature size");
  }
  return signature;
}

export function verifyMessage(publicKey: Hex, message: Hex, signature: Uint8Array): boolean {
  return slh_dsa_sha2_128s.verify(signature, hexToBytes(message), hexToBytes(publicKey));
}

export function destroyGuardian(material: GuardianMaterial | null): void {
  material?.secretKey.fill(0);
}
