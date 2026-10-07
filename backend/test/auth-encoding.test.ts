import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { hexToBytes } from "viem";
import { slh_dsa_sha2_128s } from "@noble/post-quantum/slh-dsa.js";
import {
  AuthorizationAction,
  WALLET_A,
  addressSubject,
  encodeAuthorizationPayload,
} from "@q2fa/shared";

const TEST_RECIPIENT = "0x000000000000000000000000000000000000dEaD" as const;

test("Q2FA authorization is fixed-width ABI data and a local SLH-DSA key signs it", () => {
  const seed = randomBytes(slh_dsa_sha2_128s.lengths.seed!);
  const keys = slh_dsa_sha2_128s.keygen(seed);
  const payload = encodeAuthorizationPayload({
    chainId: 5042,
    account: WALLET_A,
    action: AuthorizationAction.Withdraw,
    subject: addressSubject(TEST_RECIPIENT),
    amount: 1n,
    nonce: 0n,
    deadline: 2_000_000_000n,
  });
  const message = hexToBytes(payload);
  const signature = slh_dsa_sha2_128s.sign(message, keys.secretKey);

  try {
    assert.equal(keys.publicKey.length, 32);
    assert.equal(signature.length, 7_856);
    assert.equal(message.length, 256);
    assert.equal(slh_dsa_sha2_128s.verify(signature, message, keys.publicKey), true);

    const changed = message.slice();
    changed[64] ^= 1;
    assert.equal(slh_dsa_sha2_128s.verify(signature, changed, keys.publicKey), false);

    const corruptedSignature = signature.slice();
    corruptedSignature[0] ^= 1;
    assert.equal(slh_dsa_sha2_128s.verify(corruptedSignature, message, keys.publicKey), false);
  } finally {
    seed.fill(0);
    keys.secretKey.fill(0);
    signature.fill(0);
  }
});

test("chain, account, action, subject, amount, nonce, and deadline each change the signed payload", () => {
  const baseline = {
    chainId: 5042,
    account: WALLET_A,
    action: AuthorizationAction.Withdraw,
    subject: addressSubject(TEST_RECIPIENT),
    amount: 1n,
    nonce: 0n,
    deadline: 2_000_000_000n,
  };
  const original = encodeAuthorizationPayload(baseline);
  const variations = [
    { ...baseline, chainId: 5043 },
    { ...baseline, account: "0x0000000000000000000000000000000000000001" as const },
    { ...baseline, action: AuthorizationAction.ChangeOwner },
    { ...baseline, subject: addressSubject("0x0000000000000000000000000000000000000001") },
    { ...baseline, amount: 2n },
    { ...baseline, nonce: 1n },
    { ...baseline, deadline: baseline.deadline + 1n },
  ];

  for (const input of variations) assert.notEqual(encodeAuthorizationPayload(input), original);
});
