import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ARC_CHAIN_ID } from "@q2fa/shared";
import type { ConnectedWallet } from "./wallet.js";

export interface AppShellProps {
  wallet?: ConnectedWallet;
  accountOwner?: string;
  accountAddress?: string;
  busy: boolean;
  error?: string;
  notice?: string;
  onConnect: () => void;
  onSwitchNetwork: () => void;
}

const mainLinks = [
  { to: "/overview", label: "Overview", icon: "overview" },
  { to: "/send", label: "Send USDC", icon: "send" },
  { to: "/deposit", label: "Deposit", icon: "deposit" },
  { to: "/activity", label: "Activity", icon: "activity" },
  { to: "/security", label: "Security demo", icon: "security" },
] as const;

const routeTitles: Record<string, string> = {
  "/overview": "Overview",
  "/send": "Send USDC",
  "/deposit": "Deposit",
  "/activity": "Activity",
  "/security": "Security demo",
  "/docs": "Docs",
};

export function AppShell({ wallet, accountOwner, accountAddress, busy, error, notice, onConnect, onSwitchNetwork }: AppShellProps) {
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstNavLink = useRef<HTMLAnchorElement>(null);
  const title = routeTitles[location.pathname] ?? "Overview";
  const wrongChain = Boolean(wallet && wallet.chainId !== ARC_CHAIN_ID);
  const wrongOwner = Boolean(wallet && accountOwner && wallet.address.toLowerCase() !== accountOwner.toLowerCase());

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    firstNavLink.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileNavOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavOpen]);

  function closeMobileNav() {
    setMobileNavOpen(false);
    menuButton.current?.focus();
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#route-content">Skip to content</a>
      <aside
        id="q2fa-sidebar"
        className={`sidebar${mobileNavOpen ? " is-open" : ""}`}
        aria-label="Main navigation"
        aria-hidden={isMobile && !mobileNavOpen ? true : undefined}
        inert={isMobile && !mobileNavOpen}
      >
        <div className="sidebar-brand-lockup">
          <NavLink className="brand" to="/overview" aria-label="Q2FA overview" onClick={() => isMobile && closeMobileNav()}>
            <span className="brand-mark" aria-hidden="true">Q</span>
            <span className="brand-wordmark">Q2FA</span>
          </NavLink>
          <span className="brand-descriptor">Post-quantum protected account</span>
        </div>

        <div className="sidebar-rule" />
        <p className="sidebar-label">Account</p>
        <nav className="sidebar-nav" aria-label="Account pages">
          {mainLinks.map((item, index) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `sidebar-link${isActive ? " is-active" : ""}`}
              onClick={() => isMobile && closeMobileNav()}
              ref={index === 0 ? firstNavLink : undefined}
            >
              <SidebarIcon name={item.icon} />
              <span>{item.label}</span>
              {item.to === "/security" && <span className="nav-count" aria-label="2 factors required">2/2</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-rule" />
          <NavLink to="/docs" className={({ isActive }) => `sidebar-link${isActive ? " is-active" : ""}`} onClick={() => isMobile && closeMobileNav()}>
            <SidebarIcon name="docs" />
            <span>Docs</span>
          </NavLink>
          <div className="sidebar-account-chip">
            <span className="account-chip-mark" aria-hidden="true"><SidebarIcon name="shield" /></span>
            <span><strong>Protected account</strong><small>Arc Mainnet · 5042</small></span>
          </div>
        </div>
      </aside>

      {isMobile && mobileNavOpen && <button className="drawer-backdrop" type="button" aria-label="Close navigation" onClick={closeMobileNav} />}

      <div className="shell-main">
        <header className="app-header">
          <div className="header-leading">
            <button
              ref={menuButton}
              className="menu-toggle"
              type="button"
              aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileNavOpen}
              aria-controls="q2fa-sidebar"
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              <span aria-hidden="true">{mobileNavOpen ? "×" : "☰"}</span>
            </button>
            <div className="page-identity">
              <span className="header-kicker">Q2FA ACCOUNT</span>
              <h1>{title}</h1>
            </div>
          </div>
          <div className="header-actions">
            <span className="network-status"><span className="network-indicator" aria-hidden="true" /><span className="network-name">Arc Mainnet</span><span className="network-chain">5042</span></span>
            {wallet ? (
              <button className="wallet-control" type="button" onClick={onConnect} disabled={busy} aria-label={`Reconnect wallet ${wallet.address}`}>
                <span className="wallet-control-icon" aria-hidden="true">⌁</span>
                <span className="wallet-control-address">{shortValue(wallet.address)}</span>
              </button>
            ) : (
              <button className="button button-connect" type="button" onClick={onConnect} disabled={busy}>{busy ? "Connecting…" : <><span className="connect-full">Connect wallet</span><span className="connect-compact">Connect</span></>}</button>
            )}
          </div>
        </header>

        <main id="route-content" className="route-outlet" tabIndex={-1}>
          {error && <div className="shell-alert shell-alert-error" role="alert"><span className="alert-symbol" aria-hidden="true">!</span><p>{error}</p></div>}
          {notice && !error && <div className="shell-alert shell-alert-notice" role="status"><span className="alert-symbol" aria-hidden="true">✓</span><p>{notice}</p></div>}
          {wrongChain && <div className="shell-alert shell-alert-warning"><div><strong>Switch to Arc Mainnet</strong><p>Your wallet is on chain {wallet?.chainId}. Read-only account data remains available; protected actions are disabled.</p></div><button className="button button-secondary button-compact" type="button" onClick={onSwitchNetwork} disabled={busy}>Switch network</button></div>}
          {wrongOwner && <div className="shell-alert shell-alert-warning"><div><strong>Connected wallet is not this account’s owner</strong><p>Account data remains read-only. Connect the wallet recorded as this account’s live owner to prepare or submit protected actions.</p></div></div>}
          <div className="route-content"><Outlet /></div>
          <footer className="app-footer">
            <span>Two factors authorize protected actions. Funds in your EVM wallet remain outside Q2FA protection.</span>
            {accountAddress && <a href={`https://explorer.arc.io/address/${accountAddress}`} target="_blank" rel="noreferrer">View this account on Arc Explorer <span aria-hidden="true">↗</span></a>}
          </footer>
        </main>
      </div>
    </div>
  );
}

function SidebarIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    overview: "M3 10.5 12 3l9 7.5M5 9v11h14V9M9 20v-6h6v6",
    send: "M4 12h15M13 6l6 6-6 6",
    deposit: "M12 3v12m0 0 4-4m-4 4-4-4M4 18v3h16v-3",
    activity: "M3 12h4l2.2-6 4.1 12 2.2-6H21",
    security: "M12 3 20 6v5c0 5-3.4 8-8 10-4.6-2-8-5-8-10V6l8-3Zm-3 9 2 2 4-4",
    docs: "M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6",
    shield: "M12 3 20 6v5c0 5-3.4 8-8 10-4.6-2-8-5-8-10V6l8-3Z",
  };
  return <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.overview} /></svg>;
}

function shortValue(value: string): string {
  return value.length < 20 ? value : `${value.slice(0, 7)}…${value.slice(-5)}`;
}
