import type { ReactNode } from "react";
import type { Address } from "viem";
import type { ActivityEntry } from "./dashboard-logic.js";
import { formatUsdc, shortenAddress } from "./dashboard-logic.js";

const EXPLORER_TX = "https://explorer.arc.io/tx/";

export function SecurityStatusCard({
  owner,
  guardianKey,
  nonce,
  ownerActive,
  guardianActive,
  guardianReady,
}: {
  owner: Address;
  guardianKey: string;
  nonce: bigint;
  ownerActive: boolean;
  guardianActive: boolean;
  guardianReady: boolean;
}) {
  const protectionActive = ownerActive && guardianActive;
  return (
    <section className={`security-card${protectionActive ? " is-active" : " is-warning"}`} aria-labelledby="security-card-title">
      <div className="security-card-heading">
        <div>
          <p className="eyebrow">Security status</p>
          <h2 id="security-card-title">{protectionActive ? "Protection active" : "Check account security"}</h2>
        </div>
        <span className="factor-count">{protectionActive ? "2 / 2" : "Review"}<small>{protectionActive ? "factors required" : "account state"}</small></span>
      </div>
      <ul className="factor-list">
        <FactorRow
          title="EVM owner wallet"
          value={shortenAddress(owner)}
          fullValue={owner}
          active={ownerActive}
          activeLabel="Active on account"
          inactiveLabel="Does not match expected owner"
        />
        <FactorRow
          title="Post-quantum guardian"
          value={shortenAddress(guardianKey, 10, 6)}
          fullValue={guardianKey}
          active={guardianActive}
          activeLabel="Active on account"
          inactiveLabel="No guardian configured"
          localStatus={guardianReady ? "Ready in this tab" : "Restore to approve actions"}
        />
      </ul>
      <p className="security-card-footnote">
        Protected funds can move only when both factors approve the same action.
        <span> EVM wallet alone is not enough.</span>
      </p>
      <p className="security-nonce"><span>Current nonce</span><strong>{nonce.toString()}</strong></p>
    </section>
  );
}

function FactorRow({
  title,
  value,
  fullValue,
  active,
  activeLabel,
  inactiveLabel,
  localStatus,
}: {
  title: string;
  value: string;
  fullValue: string;
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  localStatus?: string;
}) {
  return (
    <li className="factor-row">
      <span className={`factor-check${active ? "" : " is-off"}`} aria-hidden="true">{active ? "✓" : "–"}</span>
      <div className="factor-copy">
        <strong>{title}</strong>
        <code title={fullValue}>{value}</code>
        {localStatus && <span className="factor-local-status">{localStatus}</span>}
      </div>
      <span className={`factor-state${active ? " is-active" : " is-off"}`}>{active ? activeLabel : inactiveLabel}</span>
    </li>
  );
}

export function ActivityFeed({
  items,
  decimals = 6,
  loading = false,
  error,
  diagnostic,
  description,
  emptyAction,
  title = "Recent activity",
  limit,
}: {
  items: ActivityEntry[];
  decimals?: number;
  loading?: boolean;
  error?: string;
  diagnostic?: string;
  description?: string;
  emptyAction?: ReactNode;
  title?: string;
  limit?: number;
}) {
  const visibleItems = limit === undefined ? items : items.slice(0, limit);
  return (
    <section className="content-card activity-card" aria-labelledby="activity-title">
      <div className="section-heading">
        <div><p className="eyebrow">On Arc Mainnet</p><h2 id="activity-title">{title}</h2></div>
      </div>
      {description && <p className="helper-copy">{description}</p>}
      {loading ? <p className="empty-state" role="status">Loading account activity…</p> : error ? (
        <div className="inline-error" role="alert"><p>{error}</p>{diagnostic && <details className="diagnostic-details"><summary>Technical details</summary><code>{diagnostic}</code></details>}{emptyAction}</div>
      ) : visibleItems.length === 0 ? (
        <div className="empty-state"><p>No Q2FA activity found in this range.</p><p className="helper-copy">Deposits appear from Arc USDC transfers. Protected account changes come from Q2FA events.</p>{emptyAction}</div>
      ) : (
        <ol className="activity-list">
          {visibleItems.map((item) => (
            <li className="activity-item" key={item.id}>
              <span className={`activity-mark activity-${item.action.toLowerCase().replaceAll(" ", "-")}`} aria-hidden="true">{activityMark(item.action)}</span>
              <div className="activity-main">
                <div className="activity-title-row">
                  <strong>{item.action}</strong>
                  {item.amount !== undefined && <span className="activity-amount">{formatUsdc(item.amount, decimals)}</span>}
                </div>
                {item.address && <p className="activity-detail">{item.addressLabel ?? "Address"}: <code title={item.address}>{shortenAddress(item.address)}</code></p>}
                {item.addressLabel && !item.address && <p className="activity-detail">{item.addressLabel}</p>}
                <div className="activity-meta">
                  <span>{formatActivityDate(item.timestamp)} · Block {item.blockNumber.toString()}</span>
                  {item.networkFee !== undefined && <span>Fee {formatUsdc(item.networkFee, 18)}</span>}
                </div>
                <a className="transaction-link" href={`${EXPLORER_TX}${item.transactionHash}`} target="_blank" rel="noreferrer" aria-label={`View ${item.action} transaction on Arc Explorer`}>
                  <span>View transaction</span><code>{shortenAddress(item.transactionHash, 12, 8)}</code>
                </a>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function activityMark(action: ActivityEntry["action"]): string {
  if (action === "Deposit") return "+";
  if (action === "Protected withdrawal") return "↗";
  if (action === "Owner changed") return "↔";
  return "◇";
}

function formatActivityDate(timestamp?: bigint): string {
  if (timestamp === undefined) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(Number(timestamp) * 1_000);
}

export function StatusAlert({ message, detail }: { message: string; detail?: string }) {
  return (
    <div className="error-alert" role="alert">
      <span className="alert-mark" aria-hidden="true">!</span>
      <div><p>{message}</p>{detail && <details><summary>Technical details</summary><code>{detail}</code></details>}</div>
    </div>
  );
}

export function LoadingPanel({ label = "Loading Arc Mainnet account…" }: { label?: string }) {
  return <p className="loading-panel" role="status"><span className="loading-dot" aria-hidden="true" />{label}</p>;
}

export function ShortAddress({ value, className = "" }: { value: string; className?: string }) {
  return <code className={`short-address ${className}`} title={value}>{shortenAddress(value, 12, 8)}</code>;
}
