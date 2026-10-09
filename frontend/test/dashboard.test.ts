import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthorizationAction, ARC_CHAIN_ID, DEMO_Q2FA_ACCOUNT, DEMO_OWNER_WALLET, DEMO_RECIPIENT_WALLET, addressSubject } from "@q2fa/shared";
import { ActivityFeed, SecurityStatusCard } from "../src/dashboard-components.js";
import {
  buildWithdrawalPayload,
  canSubmitProtectedAction,
  guardianMatchesOnchain,
  runSecurityDemo,
  verifyGuardianOnlyBlocked,
  verifyWalletOnlyBlocked,
  validateSendRequest,
  type ActivityEntry,
} from "../src/dashboard-logic.js";
import { q2faAccountAbi } from "../src/contracts.js";
import { extractContractErrorName } from "../src/contract-errors.js";

const guardianKey = `0x${"ab".repeat(32)}` as `0x${string}`;
const txHash = `0x${"cd".repeat(32)}` as `0x${string}`;

test("security overview renders live owner, active guardian, and current nonce", () => {
  const html = renderToStaticMarkup(React.createElement(SecurityStatusCard, {
    owner: DEMO_OWNER_WALLET,
    guardianKey,
    nonce: 41n,
    ownerActive: true,
    guardianActive: true,
    guardianReady: true,
  }));
  assert.match(html, /Protection active/);
  assert.match(html, /2 \/ 2/);
  assert.match(html, /EVM owner wallet/);
  assert.match(html, /Post-quantum guardian/);
  assert.match(html, /0xabababab/);
  assert.match(html, /41/);
  assert.match(html, /Ready in this tab/);
});

test("active guardian import comparison accepts a match and rejects a mismatch", () => {
  assert.equal(guardianMatchesOnchain(guardianKey, guardianKey), true);
  assert.equal(guardianMatchesOnchain(guardianKey, `0x${"ac".repeat(32)}`), false);
});

test("send form rejects invalid recipient and invalid or over-balance amounts", () => {
  assert.throws(() => validateSendRequest("bad-address", "1", 2_000_000n), /valid EVM recipient/);
  assert.throws(() => validateSendRequest(DEMO_RECIPIENT_WALLET, "0", 2_000_000n), /greater than zero/);
  assert.throws(() => validateSendRequest(DEMO_RECIPIENT_WALLET, "1.0000001", 2_000_000n), /up to 6 decimal/);
  assert.throws(() => validateSendRequest(DEMO_RECIPIENT_WALLET, "3", 2_000_000n), /exceeds the protected/);
});

test("protected withdrawal builder returns a deterministic withdraw action payload", () => {
  const payload = buildWithdrawalPayload({
    chainId: ARC_CHAIN_ID,
    account: DEMO_Q2FA_ACCOUNT,
    subject: addressSubject(DEMO_RECIPIENT_WALLET),
    amount: 1n,
    nonce: 3n,
    deadline: 1_900_000_000n,
  });
  assert.equal(payload.length, 514);
  assert.equal(buildWithdrawalPayload({
    chainId: ARC_CHAIN_ID,
    account: DEMO_Q2FA_ACCOUNT,
    subject: addressSubject(DEMO_RECIPIENT_WALLET),
    amount: 1n,
    nonce: 3n,
    deadline: 1_900_000_000n,
  }), payload);
  assert.notEqual(payload, buildWithdrawalPayload({
    chainId: ARC_CHAIN_ID,
    account: DEMO_Q2FA_ACCOUNT,
    subject: addressSubject(DEMO_RECIPIENT_WALLET),
    amount: 2n,
    nonce: 3n,
    deadline: 1_900_000_000n,
  }));
  assert.equal(AuthorizationAction.Withdraw, 0);
});

test("submission gate accepts the owner on Arc with guardian and simulation, rejects wrong wallet or chain", () => {
  const valid = {
    connectedAddress: DEMO_OWNER_WALLET,
    accountOwner: DEMO_OWNER_WALLET,
    walletChainId: ARC_CHAIN_ID,
    rpcChainId: ARC_CHAIN_ID,
    guardianMatched: true,
    simulationPassed: true,
  };
  assert.equal(canSubmitProtectedAction(valid), true);
  assert.equal(canSubmitProtectedAction({ ...valid, connectedAddress: DEMO_RECIPIENT_WALLET }), false);
  assert.equal(canSubmitProtectedAction({ ...valid, walletChainId: 1 }), false);
  assert.equal(canSubmitProtectedAction({ ...valid, guardianMatched: false }), false);
  assert.equal(canSubmitProtectedAction({ ...valid, simulationPassed: false }), false);
});

test("stolen-wallet demo requires a real expected rejection and valid two-factor simulation", async () => {
  let validSimulationCalled = false;
  const outcome = await runSecurityDemo(
    async () => { throw Object.assign(new Error("reverted"), { errorName: "InvalidPQSignatureLength" }); },
    async () => { validSimulationCalled = true; },
    (error) => extractContractErrorName(error, q2faAccountAbi),
    "same-key guardian authorization",
  );
  assert.equal(validSimulationCalled, true);
  assert.equal(outcome.walletOnly, "blocked");
  assert.equal(outcome.twoFactor, "authorized");

  await assert.rejects(runSecurityDemo(
    async () => undefined,
    async () => undefined,
    (error) => extractContractErrorName(error, q2faAccountAbi),
    "test action",
  ), /unexpectedly succeeded/);
  await assert.rejects(runSecurityDemo(
    async () => { throw Object.assign(new Error("reverted"), { errorName: "NotOwner" }); },
    async () => undefined,
    (error) => extractContractErrorName(error, q2faAccountAbi),
    "test action",
  ), /unexpected result/);
});

test("stolen-wallet block can be verified independently before a guardian is loaded", async () => {
  let simulationCalled = false;
  const outcome = await verifyWalletOnlyBlocked(
    async () => {
      simulationCalled = true;
      throw Object.assign(new Error("reverted"), { errorName: "InvalidPQSignatureLength" });
    },
    (error) => extractContractErrorName(error, q2faAccountAbi),
  );
  assert.equal(simulationCalled, true);
  assert.equal(outcome.walletOnly, "blocked");
  assert.equal(outcome.walletOnlyReason, "PQ authorization missing");
  await assert.rejects(verifyWalletOnlyBlocked(
    async () => { throw Object.assign(new Error("reverted"), { errorName: "NotOwner" }); },
    (error) => extractContractErrorName(error, q2faAccountAbi),
  ), /unexpected result/);
});

test("guardian-only demo requires a validly signed action to fail specifically as non-owner", async () => {
  let simulationCalled = false;
  const outcome = await verifyGuardianOnlyBlocked(
    async () => {
      simulationCalled = true;
      throw Object.assign(new Error("reverted"), { errorName: "NotOwner" });
    },
    (error) => extractContractErrorName(error, q2faAccountAbi),
  );
  assert.equal(simulationCalled, true);
  assert.equal(outcome.guardianOnly, "blocked");
  assert.equal(outcome.guardianOnlyReason, "EVM owner authorization missing");
  await assert.rejects(verifyGuardianOnlyBlocked(
    async () => { throw Object.assign(new Error("reverted"), { errorName: "InvalidPQSignature" }); },
    (error) => extractContractErrorName(error, q2faAccountAbi),
  ), /unexpected result/);
  await assert.rejects(verifyGuardianOnlyBlocked(
    async () => undefined,
    (error) => extractContractErrorName(error, q2faAccountAbi),
  ), /unexpectedly succeeded/);
});

test("activity entries render action, amount, recipient, and Arc Explorer link", () => {
  const entry: ActivityEntry = {
    id: txHash,
    action: "Protected withdrawal",
    amount: 1_000_000n,
    address: DEMO_RECIPIENT_WALLET,
    addressLabel: "Recipient",
    blockNumber: 24_896_900n,
    timestamp: 1_750_000_000n,
    transactionHash: txHash,
    networkFee: 1_000_000_000_000_000n,
  };
  const html = renderToStaticMarkup(React.createElement(ActivityFeed, { items: [entry] }));
  assert.match(html, /Protected withdrawal/);
  assert.match(html, /1 USDC/);
  assert.match(html, /Recipient/);
  assert.match(html, /explorer\.arc\.io\/tx\//);
  assert.match(html, /24,896,900|24896900/);
});

test("activity loading and RPC error states are visible", () => {
  const loading = renderToStaticMarkup(React.createElement(ActivityFeed, { items: [], loading: true }));
  assert.match(loading, /Loading account activity/);
  const error = renderToStaticMarkup(React.createElement(ActivityFeed, { items: [], error: "Arc RPC is unavailable." }));
  assert.match(error, /Arc RPC is unavailable/);
});
