import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadProviderSecret } from '../src/infrastructure/provider-secret.js';

test('local provider secret roundtrip uses protected storage and errors reveal no credential', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ligado-pay-secret-'));
  const secret = `token.${randomBytes(32).toString('base64')}`;
  const path = join(directory, process.platform === 'win32' ? 'test.dpapi' : 'test.key');
  try {
    let stored = secret;
    if (process.platform === 'win32') {
      const powershell = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      stored = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
        '$s=[Console]::In.ReadToEnd() | ConvertTo-SecureString -AsPlainText -Force; ConvertFrom-SecureString $s'],
      { input: secret, env: { ...process.env, PSModulePath: join(process.env['SystemRoot'] ?? 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/Modules') },
      encoding: 'utf8', windowsHide: true, stdio: ['pipe','pipe','pipe'] }).trim();
      assert.equal(stored.includes(secret), false);
    }
    writeFileSync(path, stored, { mode: 0o600 });
    assert.equal(loadProviderSecret(path), secret);
    writeFileSync(path, 'invalid\r\nheader');
    assert.throws(() => loadProviderSecret(path), error => {
      assert.equal((error as Error).message, 'Provider credential unavailable or not protected.');
      assert.equal(String(error).includes(secret), false); return true;
    });
  } finally { if (existsSync(path)) unlinkSync(path); rmdirSync(directory); }
});
