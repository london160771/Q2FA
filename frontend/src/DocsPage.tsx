import { Link } from "react-router-dom";
import { DEMO_OWNER_WALLET, DEMO_Q2FA_ACCOUNT } from "@q2fa/shared";

const sections = [
  {
    title: "What is Q2FA?",
    body: "Q2FA is a post-quantum two-factor smart account on Arc Mainnet. The normal EVM owner wallet is Factor 1; an independent SLH-DSA-SHA2-128s guardian is Factor 2. Both must authorize a protected action before USDC held by the account can move.",
  },
  {
    title: "How the two factors work",
    body: "The guardian signs a deterministic payload that binds the chain, Q2FA account, action, recipient or subject, amount where applicable, nonce, and expiry. The current EVM owner submits that same action. The account checks both factors and consumes the nonce on success. Changing a bound value invalidates the signature.",
  },
  {
    title: "Factor 1 — EVM wallet",
    body: "The account’s current owner uses a normal EVM wallet to submit a protected transaction and pay Arc network fees in USDC. The wallet remains Factor 1; possession of this key alone does not satisfy the account’s authorization rules.",
  },
  {
    title: "Factor 2 — PQ guardian",
    body: "A local SLH-DSA-SHA2-128s guardian signs the exact protected action. The account verifies the signature onchain through Arc’s built-in verifier. Only the public guardian key is account state; the seed is imported and used locally in the active browser session.",
  },
  {
    title: "Why Arc",
    body: "Q2FA isn’t just deployed on Arc. Its second factor works because Arc can verify the guardian’s SLH-DSA signature directly onchain. The account calls Arc’s built-in verifier as part of authorization, so the PQ approval is a contract check rather than an offchain service or frontend convention. Without Arc’s native verifier, this exact design would need a substantially heavier custom verifier, an external verification system, or a different architecture. Arc is the infrastructure that makes this post-quantum second factor practical onchain. The verifier is experimental/emerging infrastructure.",
  },
  {
    title: "Protected withdrawal flow",
    body: "Enter a recipient and amount. The client reads the account’s current nonce and expiry, displays the exact action, and asks the local guardian to sign it. The owner wallet then submits the action. The Q2FA account verifies the owner, deadline, nonce, and PQ signature before transferring USDC. The client can simulate the transaction read-only on Arc Mainnet and estimate the USDC network fee first.",
  },
  {
    title: "Threat model",
    body: "Q2FA is designed so that an attacker with only the owner EVM key cannot complete a protected withdrawal from the smart account. The model still depends on the guardian remaining independent, the browser and signing device being trustworthy, and the contract and Arc verifier behaving as expected. Q2FA does not claim either key or the system is immune to compromise.",
  },
  {
    title: "What Q2FA protects",
    body: "USDC deposited into a Q2FA smart account is subject to its two-factor protected actions. Deposits are ordinary transfers into the account and do not need PQ approval; the authorization rule applies to actions that move protected funds out.",
  },
  {
    title: "What Q2FA does not protect",
    body: "Funds left directly in the owner’s normal EVM wallet are outside the Q2FA account. V1 has no guardian recovery, social recovery, owner recovery, or cloud backup. Losing the guardian backup can make protected actions unavailable. Any future recovery path must not bypass the two-factor rule.",
  },
  {
    title: "Guardian backup and restore",
    body: "Generate the guardian locally, download a seed backup to a location you control, and re-import it to verify that it derives the same public key before account creation. The seed is not sent to the backend or stored onchain. After restore, the secret remains in browser memory only and is not written to browser storage. Keep the backup offline. Q2FA does not provide cloud recovery.",
  },
  {
    title: "Current limitations",
    body: "Arc’s PQ verifier is experimental/emerging infrastructure, and Q2FA’s contracts have not received an external security audit. SLH-DSA signatures are large and can cost more gas and calldata than ordinary EVM signatures. Only deposited smart-account funds are protected. Losing the guardian backup can block protected actions because recovery is not included in V1.",
  },
  {
    title: "Protocol / app deployment",
    body: "The current multi-user deployment is the Arc Mainnet factory at 0x378330579a0c76215994e774b95a3413c2efba34. For a connected wallet, the app reads accountOf(wallet): it loads that wallet’s account when one exists or offers onboarding when none exists. Account creation uses the connected wallet as msg.sender and rejects a duplicate account for that owner. The legacy demo account is not a fallback for other wallets. The frontend reads account state directly from Arc; the backend health service is optional and does not authorize actions.",
  },
  {
    title: "Example verified Q2FA account",
    body: `The first factory-created example belongs to 0xbAbDFEF588cF57eFcc7c8857960E3CCdD9167589 and is 0xEBA06bB7be5301F4aa12285c26Df2d519ecA88c9. It was created at block 25064021 in transaction 0x8f9329acb707532cf39aa189a3baa8299374e2761ab53f76b32e29fe0de6cb5d. This is one account’s verification evidence, not a global product account. The separate historical Phase 1–3 demo account is ${DEMO_Q2FA_ACCOUNT}, originally owned by ${DEMO_OWNER_WALLET}; it remains a demo fixture and is never loaded as another wallet’s account.`,
  },
  {
    title: "Security verification",
    body: "The live Security Demo runs read-only Arc Mainnet eth_call simulations. An owner call with no PQ signature is blocked; a valid guardian signature submitted by a non-owner is blocked; the live owner plus active guardian can authorize a withdrawal simulation. The demo displays decoded contract outcomes, not hardcoded success or failure states. Mainnet read-only simulations also exercised recipient, amount, action, expiry, stale nonce, and corrupted-signature failures. Changed account/domain and cross-user cases are covered by local regression tests and independent account-discovery checks. No failed transaction is broadcast.",
  },
] as const;

export function DocsPage() {
  return (
    <section className="docs-page" aria-labelledby="docs-title">
      <div className="page-intro">
        <p className="eyebrow">Q2FA field guide</p>
        <h2 id="docs-title">What if someone steals your wallet key?</h2>
        <p>In a normal EVM wallet, that key may be enough to move your funds. Q2FA makes the wallet only Factor 1. Protected actions also require an independent post-quantum guardian.</p>
      </div>

      <div className="docs-flow" aria-label="EVM wallet plus PQ guardian equals protected action">
        <div className="docs-factor"><span className="docs-factor-index">01</span><strong>EVM Wallet</strong><small>Submits the owner transaction</small></div>
        <span className="docs-plus" aria-hidden="true">+</span>
        <div className="docs-factor"><span className="docs-factor-index">02</span><strong>PQ Guardian</strong><small>Signs the exact action</small></div>
        <span className="docs-equals" aria-hidden="true">=</span>
        <div className="docs-result"><span>2 / 2 required</span><strong>Protected Action</strong></div>
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
