import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, keccak256, toBytes, toHex, type Address } from "viem";
import {
  ARC_CHAIN_ID,
  AUTHORIZATION_SCHEMA,
  AuthorizationAction,
  addressSubject,
  encodeAuthorizationPayload,
} from "@q2fa/shared";
import { generateGuardian, importGuardianSeed, signMessage, verifyMessage } from "../src/guardian.js";

const input = {
  chainId: ARC_CHAIN_ID,
  account: "0xc27bd794db0e7d2cf636fbd7872d05e92cc295d2" as Address,
  action: AuthorizationAction.Withdraw,
  subject: addressSubject("0x815C2fb8178F0bf80aDa8C5B97fF44Ece90e6e25" as Address),
  amount: 1n,
  nonce: 9n,
  deadline: 1_900_000_000n,
};

test("client authorization bytes match Solidity abi.encode output exactly", () => {
  const actual = encodeAuthorizationPayload(input);
  const expected = encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint8" },
      { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
    ],
    [AUTHORIZATION_SCHEMA, BigInt(input.chainId), input.account, input.action, input.subject, input.amount, input.nonce, input.deadline],
  );
  assert.equal(actual.toLowerCase(), expected.toLowerCase());
  assert.equal(toBytes(actual).length, 256);
  assert.equal(keccak256(actual), keccak256(expected));
});

test("changing every protected field changes the signed authorization", () => {
  const baseline = keccak256(encodeAuthorizationPayload(input));
  const variants = [
    { ...input, subject: addressSubject("0x90e3a58694e953f5eC4018fF7dd57BE036f11FcE" as Address) },
    { ...input, amount: 2n },
    { ...input, account: "0x1111111111111111111111111111111111111111" as Address },
    { ...input, chainId: 5043 },
    { ...input, action: AuthorizationAction.ChangeOwner },
    { ...input, nonce: input.nonce + 1n },
    { ...input, deadline: input.deadline + 1n },
  ];
  for (const variant of variants) assert.notEqual(keccak256(encodeAuthorizationPayload(variant)), baseline);
});

test("fresh client guardian has Arc sizes and signs the exact withdrawal message", () => {
  const guardian = generateGuardian();
  try {
    const message = encodeAuthorizationPayload(input);
    const signature = signMessage(guardian.secretKey, message);
    assert.equal(toBytes(guardian.publicKey).length, 32);
    assert.equal(signature.length, 7_856);
    assert.equal(verifyMessage(guardian.publicKey, message, signature), true);

    const changedMessage = toHex(Uint8Array.from(toBytes(message), (byte, index) => index === 100 ? byte ^ 1 : byte));
    assert.equal(verifyMessage(guardian.publicKey, changedMessage, signature), false);

    const corrupted = Uint8Array.from(signature);
    corrupted[0] ^= 1;
    assert.equal(verifyMessage(guardian.publicKey, message, corrupted), false);
    signature.fill(0);
    corrupted.fill(0);
  } finally {
    guardian.secretKey.fill(0);
  }
});

test("a 48-byte seed restores the same client guardian keys", () => {
  const generated = generateGuardian();
  const seed = generated.secretKey.slice(0, 48);
  let restored: ReturnType<typeof importGuardianSeed> | undefined;
  try {
    restored = importGuardianSeed(toHex(seed));
    assert.equal(restored.publicKey, generated.publicKey);
    assert.deepEqual(restored.secretKey, generated.secretKey);
  } finally {
    seed.fill(0);
    generated.secretKey.fill(0);
    restored?.secretKey.fill(0);
  }
});
