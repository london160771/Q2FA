import { Link } from "react-router-dom";
import { DEMO_OWNER_WALLET, DEMO_Q2FA_ACCOUNT } from "@q2fa/shared";

const sections = [
  {
    title: "What is Q2FA?",
    body: "Q2FA is an Arc smart account that requires two independent approvals before protected USDC can move: the normal EVM owner wallet and a post-quantum guardian.",
  },
  {
    title: "How the two factors work",
    body: "The guardian signs a precise action that includes the network, account, recipient, amount, nonce, and expiry. The EVM owner then submits that same action to the account. Either factor on its own is insufficient.",
  },
  {
    title: "Factor 1 — EVM wallet",
    body: "The owner wallet submits protected actions and pays Arc Mainnet network fees in USDC. Q2FA checks that the connected transaction sender is the account’s current owner.",
  },
  {
    title: "Factor 2 — PQ guardian",
    body: "The guardian uses SLH-DSA-SHA2-128s. Its seed is imported and used locally in this browser session. Q2FA checks the signature with Arc’s built-in verifier.",
  },
  {
    title: "Why Arc",
    body: "Arc Mainnet provides the EVM execution environment and a native post-quantum signature verifier used by the Q2FA account.",
  },
  {
    title: "Protected withdrawal flow",
    body: "Review the recipient, amount, account, nonce, and expiry; sign that exact payload with the active guardian; then submit it with the owner wallet. The account validates both approvals before transferring USDC.",
  },
  {
    title: "Threat model",
    body: "The design aims to prevent an attacker with only the owner EVM key from withdrawing funds held inside this Q2FA account. It does not claim that either key, the browser, or the signing device is immune to compromise.",
  },
  {
    title: "What Q2FA protects",
    body: "USDC held by the deployed Q2FA smart account is subject to its two-factor protected actions. Deposits are ordinary USDC transfers into the account.",
  },
  {
    title: "What Q2FA does not protect",
    body: "Funds left in the owner’s regular EVM wallet are outside the Q2FA account and receive no Q2FA protection. The current V1 does not provide social recovery, a cloud backup, or an emergency owner bypass.",
  },
  {
    title: "Guardian backup and restore",
    body: "Keep a guardian seed backup offline in a location you control. Import it only into a trusted local client. The app derives the public key locally and checks it against the onchain guardian; the secret stays in memory and is cleared when the session ends.",
  },
  {
    title: "Protocol / app deployment",
    body: "Q2FA accounts are created by the Arc Mainnet account factory. Each account is indexed by its current EVM owner; the app discovers only the account registered to the connected wallet and reads its state directly from Arc.",
  },
  {
    title: "Example verified Q2FA account",
    body: `This legacy demo account is ${DEMO_Q2FA_ACCOUNT}, created for the verified Phase 1–3 Mainnet proof. Its original owner was ${DEMO_OWNER_WALLET}. It is a demo fixture, not a global product account or a fallback for other wallets.`,
  },
] as const;

export function DocsPage() {
  return (
    <section className="docs-page" aria-labelledby="docs-title">
      <div className="page-intro">
        <p className="eyebrow">Q2FA field guide</p>
        <h2 id="docs-title">Two keys. One protected action.</h2>
        <p>A short guide to what the account checks, what it protects, and where its limits are.</p>
      </div>

      <div className="docs-flow" aria-label="Both independent factors are required for a protected action">
        <div className="docs-factor"><span className="docs-factor-index">01</span><strong>EVM owner wallet</strong><small>Submits and pays the network fee</small></div>
        <span className="docs-plus" aria-hidden="true">+</span>
        <div className="docs-factor"><span className="docs-factor-index">02</span><strong>PQ guardian</strong><small>Signs the exact authorization</small></div>
        <span className="docs-equals" aria-hidden="true">=</span>
        <div className="docs-result"><span>2 / 2 required</span><strong>Protected action</strong></div>
      </div>

      <div className="docs-grid">
        {sections.map((section, index) => (
          <article className={`docs-card${index === sections.length - 1 ? " docs-card-wide" : ""}`} key={section.title}>
            <span className="docs-card-number">{String(index + 1).padStart(2, "0")}</span>
            <div><h3>{section.title}</h3><p>{section.body}</p></div>
          </article>
        ))}
      </div>

      <div className="docs-next-step">
        <div><span className="eyebrow">Ready to use the account?</span><h3>Keep both factors involved.</h3><p>Deposits do not need guardian approval. Protected withdrawals do.</p></div>
        <div className="docs-actions"><Link className="button button-secondary" to="/deposit">Deposit USDC</Link><Link className="button button-primary" to="/send">Send protected USDC</Link></div>
      </div>
    </section>
  );
}
