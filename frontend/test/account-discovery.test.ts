import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_Q2FA_ACCOUNT, DEMO_OWNER_WALLET, DEMO_RECIPIENT_WALLET } from "@q2fa/shared";
import { accountIsSubmittable, buildAccountTargets, resolveAccountForOwner } from "../src/account-discovery.js";

const walletX = "0x1111111111111111111111111111111111111111" as const;
const accountX = "0x2222222222222222222222222222222222222222" as const;

test("disconnected state has no active or fallback demo account", () => {
  assert.deepEqual(resolveAccountForOwner(), { status: "disconnected" });
});

test("Wallet A resolves only the factory account returned for Wallet A", () => {
  assert.deepEqual(resolveAccountForOwner(DEMO_OWNER_WALLET, DEMO_Q2FA_ACCOUNT), {
    status: "load",
    owner: DEMO_OWNER_WALLET,
    account: DEMO_Q2FA_ACCOUNT,
  });
});

test("unknown Wallet X gets onboarding and cannot inherit the demo account", () => {
  const result = resolveAccountForOwner(walletX, "0x0000000000000000000000000000000000000000");
  assert.deepEqual(result, { status: "create", owner: walletX });
  assert.notEqual(result.status === "load" ? result.account : undefined, DEMO_Q2FA_ACCOUNT);
});

test("deposit, withdrawal, and activity targets all use the active owner's discovered account", () => {
  const targets = buildAccountTargets(accountX);
  assert.equal(targets.deposit, accountX);
  assert.equal(targets.withdrawal, accountX);
  assert.equal(targets.activity, accountX);
  assert.notEqual(targets.deposit, DEMO_Q2FA_ACCOUNT);
  assert.notEqual(targets.activity, DEMO_RECIPIENT_WALLET);
});

test("owner submission is bound to the discovered account and live owner", () => {
  const valid = { connectedOwner: walletX, liveOwner: walletX, discoveredAccount: accountX, submittedAccount: accountX };
  assert.equal(accountIsSubmittable(valid), true);
  assert.equal(accountIsSubmittable({ ...valid, connectedOwner: DEMO_OWNER_WALLET }), false);
  assert.equal(accountIsSubmittable({ ...valid, submittedAccount: DEMO_Q2FA_ACCOUNT }), false);
});
