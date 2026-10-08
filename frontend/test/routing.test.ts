import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRouter } from "../src/AppRouter.js";
import type { DashboardPages } from "../src/AppRouter.js";
import type { AppShellProps } from "../src/AppShell.js";
import { DocsPage } from "../src/DocsPage.js";
import App from "../src/App.js";

const shell: AppShellProps = {
  accountOwner: "0x90e3a58694e953f5eC4018fF7dd57BE036f11FcE",
  busy: false,
  onConnect: () => undefined,
  onSwitchNetwork: () => undefined,
};

const pages: DashboardPages = {
  overview: React.createElement("div", null, "Overview route content"),
  send: React.createElement("div", null, "Send route content"),
  deposit: React.createElement("div", null, "Deposit route content"),
  activity: React.createElement("div", null, "Activity route content"),
  security: React.createElement("div", null, "Security route content"),
  docs: React.createElement(DocsPage),
};

function renderPath(path: string): string {
  return renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: [path] },
      React.createElement(AppRouter, { shell, pages })),
  );
}

test("nested routes render page content and keep the active sidebar route in sync", () => {
  const html = renderPath("/activity");
  assert.match(html, /Activity route content/);
  assert.match(html, /aria-current="page" class="sidebar-link is-active" href="\/activity"/);
  assert.match(html, /<h1>Activity<\/h1>/);
});

test("root and unknown routes redirect to Overview", () => {
  const root = renderPath("/");
  const unknown = renderPath("/not-a-page");
  assert.doesNotMatch(root, /Overview route content/);
  assert.doesNotMatch(unknown, /Overview route content/);
  assert.match(root, /href="\/overview"/);
  assert.match(unknown, /href="\/overview"/);
});

test("Deposit and Docs are independent routes in the application shell", () => {
  const deposit = renderPath("/deposit");
  assert.match(deposit, /Deposit route content/);
  assert.match(deposit, /<h1>Deposit<\/h1>/);
  const docs = renderPath("/docs");
  assert.match(docs, /What is Q2FA\?/);
  assert.match(docs, /Guardian backup and restore/);
  assert.match(docs, /Protocol \/ app deployment/);
  assert.match(docs, /Example verified Q2FA account/);
});

test("shared header exposes network and wallet controls and mobile navigation semantics", () => {
  const html = renderPath("/overview");
  assert.match(html, /Arc Mainnet/);
  assert.match(html, /5042/);
  assert.match(html, /Connect wallet/);
  assert.match(html, /aria-label="Open navigation"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Skip to content/);
});

test("a disconnected dashboard asks for a wallet and does not expose a demo account as active", () => {
  const html = renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: ["/overview"] }, React.createElement(App)),
  );
  assert.match(html, /Connect a wallet to access your Q2FA account\./);
  assert.doesNotMatch(html, /0xa40524d1e9380d3b82752ec4bc074cc7e6272fb0/);
  assert.doesNotMatch(html, /0x90e3a58694e953f5ec4018ff7dd57be036f11fce/i);
});
