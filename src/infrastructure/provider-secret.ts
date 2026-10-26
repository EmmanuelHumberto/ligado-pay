import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Reads only the configured local secret, without logging contents or passing them as arguments. */
export function loadProviderSecret(path: string): string {
  try {
    let value: string;
    if (process.platform === 'win32') {
      if (!path.endsWith('.dpapi')) throw new Error();
      const powershell = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      value = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
        "$ErrorActionPreference='Stop'; $s=Get-Content -LiteralPath $env:LIGADO_PAY_SECRET_PATH -Raw | ConvertTo-SecureString; " +
        '$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); ' +
        'try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} ' +
        'finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}'], {
        env: { ...process.env, LIGADO_PAY_SECRET_PATH: path,
          PSModulePath: join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') },
        encoding: 'utf8', timeout: 5000,
        maxBuffer: 4096, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else {
      if ((statSync(path).mode & 0o077) !== 0) throw new Error();
      value = readFileSync(path, 'utf8').trim();
    }
    if (!/^inchk_[A-Za-z0-9_-]{16,240}$/.test(value)) throw new Error();
    return value;
  } catch { throw new Error('Provider credential unavailable or not protected.'); }
}
