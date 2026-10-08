import { formatUnits, type Address, type Hex } from "viem";
import { ShortAddress } from "./dashboard-components.js";

export interface AccountOnboardingProps {
  owner: Address;
  factoryReady: boolean;
  guardianKey?: Hex;
  backupExported: boolean;
  backupVerified: boolean;
  creationEstimate?: bigint;
  busy: boolean;
  onGenerateGuardian: () => void;
  onExportBackup: () => void;
  onImportBackup: (file?: File) => void;
  onReviewCreation: () => void;
  onCreateAccount: () => void;
}

export function AccountOnboarding({
  owner,
  factoryReady,
  guardianKey,
  backupExported,
  backupVerified,
  creationEstimate,
  busy,
  onGenerateGuardian,
  onExportBackup,
  onImportBackup,
  onReviewCreation,
  onCreateAccount,
}: AccountOnboardingProps) {
  return (
    <section className="account-onboarding" aria-labelledby="create-account-title">
      <div className="onboarding-heading">
        <p className="eyebrow">Arc Mainnet · New account</p>
        <h2 id="create-account-title">Create your protected account</h2>
        <p>Q2FA protects USDC held in a smart account owned by your connected wallet. The normal EVM wallet and a separate post-quantum guardian must approve each protected withdrawal.</p>
      </div>

      <ol className="onboarding-steps">
        <li><span>1</span><div><strong>Generate a post-quantum guardian locally</strong><small>The private material stays in this browser tab.</small></div></li>
        <li><span>2</span><div><strong>Back up the guardian seed</strong><small>Export a local file, then import it again to verify the backup.</small></div></li>
        <li><span>3</span><div><strong>Create your Q2FA account</strong><small>The factory sets the owner from the transaction sender.</small></div></li>
        <li><span>4</span><div><strong>Load your protected account</strong><small>Balance, nonce, guardian, and activity are read from Arc.</small></div></li>
      </ol>

      <div className="onboarding-owner"><span>Connected owner</span><ShortAddress value={owner} /></div>

      <section className="onboarding-guardian" aria-labelledby="onboarding-guardian-title">
        <div><p className="eyebrow">Guardian setup</p><h3 id="onboarding-guardian-title">Factor 2 · PQ guardian</h3></div>
        {guardianKey ? <p className="onboarding-public-key"><span>Public key</span><code>{guardianKey}</code></p> : <p className="card-copy">Generate a fresh guardian before account creation.</p>}
        {backupVerified && <p className="onboarding-success" role="status">Backup restoration verified locally.</p>}
        <div className="onboarding-actions">
          <button className="button button-secondary" type="button" onClick={onGenerateGuardian} disabled={busy}>{guardianKey ? "Generate a new guardian" : "Generate guardian"}</button>
          <button className="button button-secondary" type="button" onClick={onExportBackup} disabled={busy || !guardianKey}>Download seed backup</button>
          <label className="button button-secondary onboarding-file-button">Verify backup file<input type="file" accept=".hex,text/plain" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; onImportBackup(file); }} disabled={busy || !guardianKey || !backupExported} /></label>
        </div>
        <p className="microcopy">The seed is never uploaded or saved in browser storage. It remains in tab memory only after local verification.</p>
      </section>

      <section className="onboarding-create" aria-labelledby="onboarding-create-title">
        <div><p className="eyebrow">Account creation</p><h3 id="onboarding-create-title">Create account for this wallet</h3></div>
        {!factoryReady && <p className="onboarding-pending" role="status">Account creation is unavailable until the Arc Mainnet factory is deployed and verified.</p>}
        {creationEstimate !== undefined && <p className="fee-preview">Estimated Arc network fee: <strong>~{formatUnits(creationEstimate, 18)} USDC</strong></p>}
        {!creationEstimate ? (
          <button className="button button-primary" type="button" onClick={onReviewCreation} disabled={busy || !factoryReady || !backupVerified}>Review account creation</button>
        ) : (
          <button className="button button-primary" type="button" onClick={onCreateAccount} disabled={busy || !factoryReady || !backupVerified}>{busy ? "Waiting for Arc…" : "Create Q2FA account"}</button>
        )}
        {!backupVerified && <p className="inline-hint">Account creation unlocks only after you restore and verify the downloaded backup.</p>}
      </section>
    </section>
  );
}
