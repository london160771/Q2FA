import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { slh_dsa_sha2_128s } from "@noble/post-quantum/slh-dsa.js";
import { toHex } from "viem";

const backupPath = "C:\\Users\\uk\\Documents\\Codex\\.secrets\\Q2FA\\phase2-clean\\guardian-seed.hex";
let stage = "startup";

function runPowerShell(script: string, input?: string): string {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw new Error("LOCAL_BACKUP_PROCESS");
  if (result.status !== 0) {
    const failedStage = /Q2FA_STAGE:([A-Za-z-]+)/.exec(result.stderr)?.[1]?.toUpperCase().replaceAll("-", "_");
    throw new Error(`LOCAL_BACKUP_${failedStage ?? "POWERSHELL"}`);
  }
  return result.stdout;
}

function backupSeed(seedHex: string): void {
  if (existsSync(backupPath)) throw new Error("The designated Phase 2 guardian backup already exists; refusing to overwrite it.");

  const script = `
$ErrorActionPreference = 'Stop'
$stage = 'directory'
try {
  $backupPath = '${backupPath}'
  $directory = [System.IO.Path]::GetDirectoryName($backupPath)
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  if (@(Get-ChildItem -LiteralPath $directory -Force).Count -gt 0) { throw 'nonempty' }
  $stage = 'permission-identity'
  $userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if (-not $userSid) { throw 'missing identity' }
  $userRule = '*' + $userSid + ':(OI)(CI)F'
  $stage = 'permission-reset'
  & icacls.exe $directory /reset | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'reset failed' }
  $stage = 'permission-restriction'
  & icacls.exe $directory /inheritance:r /grant:r $userRule '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'restriction failed' }
  $stage = 'backup-file-exists-check'
  if ([System.IO.File]::Exists($backupPath)) { throw 'file exists' }
  $stage = 'seed-input'
  $seedText = [Console]::In.ReadLine()
  if ($seedText -notmatch '^[0-9a-fA-F]{96}$') { throw 'invalid seed input' }
  $stage = 'file-write'
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($backupPath, $seedText, $utf8)
} catch {
  [Console]::Error.WriteLine('Q2FA_STAGE:' + $stage)
  exit 1
}
`;
  runPowerShell(script, `${seedHex}\n`);
}

function restoreSeed(): string {
  const script = `
$ErrorActionPreference = 'Stop'
$seedText = [System.IO.File]::ReadAllText('${backupPath}', [System.Text.Encoding]::UTF8).Trim()
if ($seedText -notmatch '^[0-9a-fA-F]{96}$') { throw 'The local seed file has an invalid format.' }
[Console]::Out.Write($seedText)
`;
  const seedHex = runPowerShell(script);
  if (!/^[0-9a-fA-F]{96}$/.test(seedHex)) throw new Error("The local guardian seed file did not restore as a 48-byte seed.");
  return seedHex;
}

function main(): void {
  if (process.platform !== "win32") throw new Error("This helper requires Windows file-permission support.");
  if (existsSync(backupPath)) throw new Error("The designated Phase 2 guardian backup already exists; refusing to overwrite it.");
  const seed = randomBytes(slh_dsa_sha2_128s.lengths.seed!);
  let firstSecret: Uint8Array | undefined;
  let restoredSecret: Uint8Array | undefined;
  let signature: Uint8Array | undefined;
  let seedHex = "";
  let restoredHex = "";
  try {
    if (seed.length !== 48) throw new Error("SLH-DSA-SHA2-128s did not report a 48-byte seed size.");
    seedHex = Buffer.from(seed).toString("hex");
    const generated = slh_dsa_sha2_128s.keygen(seed);
    if (generated.publicKey.length !== 32 || generated.secretKey.length !== 64) {
      generated.secretKey.fill(0);
      throw new Error("SLH-DSA-SHA2-128s generated unexpected key sizes.");
    }
    firstSecret = generated.secretKey;

    stage = "local backup creation";
    backupSeed(seedHex);
    stage = "local backup restore";
    restoredHex = restoreSeed();
    stage = "restored key comparison";
    const restored = slh_dsa_sha2_128s.keygen(Buffer.from(restoredHex, "hex"));
    restoredSecret = restored.secretKey;
    if (
      restored.publicKey.length !== 32 ||
      restored.secretKey.length !== 64 ||
      !Buffer.from(restored.publicKey).equals(Buffer.from(generated.publicKey)) ||
      !Buffer.from(restored.secretKey).equals(Buffer.from(firstSecret))
    ) {
      throw new Error("The restored guardian did not match the newly generated keypair.");
    }

    stage = "local sign/verify";
    const verificationMessage = new TextEncoder().encode("Q2FA_PHASE2_GUARDIAN_BACKUP_VERIFY_V1");
    signature = slh_dsa_sha2_128s.sign(verificationMessage, restoredSecret);
    if (signature.length !== 7_856 || !slh_dsa_sha2_128s.verify(signature, verificationMessage, restored.publicKey)) {
      throw new Error("The restored guardian sign/verify round-trip failed.");
    }

    console.log(`Guardian backup and restore verification: PASS`);
    console.log(`Guardian public key: ${toHex(generated.publicKey)}`);
    console.log(`Seed backup: local file protected by current-user-only directory permissions at ${backupPath}`);
    console.log(`Public key bytes: ${generated.publicKey.length}; secret-key bytes: ${firstSecret.length}; signature bytes: ${signature.length}`);
  } finally {
    seed.fill(0);
    firstSecret?.fill(0);
    restoredSecret?.fill(0);
    signature?.fill(0);
    seedHex = "";
    restoredHex = "";
  }
}

try {
  main();
} catch (error: unknown) {
  const detail = error instanceof Error && /^LOCAL_BACKUP_[A-Z_]+$/.test(error.message)
    ? ` (${error.message})`
    : "";
  console.error(`Guardian backup failed during ${stage}${detail}. No Mainnet action was attempted.`);
  process.exitCode = 1;
}
