import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { normalizeInfinitePayCredential } from '../src/infrastructure/infinitepay/credential.js';
import { InfinitePayTransport } from '../src/infrastructure/infinitepay/transport.js';

const accepted = ['abc.def+ghi/jkl==', '01234567-89ab-cdef-0123-456789abcdef',
  'inchk_synthetic_compatible_key', '  opaque.fixture==  ', 'k'.repeat(2048)];
const refused = ['', '   ', 'opaque\r\nX-Injected: value', 'opaque key', 'key\0value', 'key\tvalue',
  'key\u007fvalue', 'key\u00e7value', 'k'.repeat(2049)];

test('opaque API keys need no invented prefix; empty, unsafe or oversized header values are rejected', () => {
  for (const value of accepted) assert.equal(normalizeInfinitePayCredential(value), value.trim());
  for (const value of refused) assert.throws(() => normalizeInfinitePayCredential(value));
});

test('transport sends a prefixless credential intact only to the fixed provider endpoint', async () => {
  const credential = 'opaque.contract.fixture+/==';
  const transport = new InfinitePayTransport(credential, async (url, init) => {
    assert.equal(url, 'https://api.checkout.infinitepay.io/payment_check');
    assert.equal((init.headers as Record<string, string>)['X-Api-Key'], credential);
    return Response.json({ success: true, paid: false });
  });
  assert.deepEqual(await transport.post('check-payment', {}), { success: true, paid: false });
});

test('key helper stays compatible with legacy PowerShell source encoding', () => {
  const source = readFileSync('scripts/guardar-chave-infinitepay.ps1');
  assert.ok(source.every(byte => byte < 128));
});

test('Windows key helper and runtime share the exact opaque credential policy without writing a secret', {
  skip: process.platform !== 'win32' ? 'Windows-specific helper; portable policy tested above' : false,
}, () => {
  const root = process.env['SystemRoot'] ?? 'C:\\Windows';
  const powershell = join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const args = ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; $global:fixture=[Console]::In.ReadToEnd() | ConvertTo-SecureString -AsPlainText -Force; " +
    'function Read-Host {param($Prompt,[switch]$AsSecureString) $global:fixture}; ' +
    '& $env:LIGADO_PAY_HELPER -ValidarApenas'];
  const env = { ...process.env, LIGADO_PAY_HELPER: resolve('scripts/guardar-chave-infinitepay.ps1'),
    PSModulePath: join(root, 'System32/WindowsPowerShell/v1.0/Modules') };
  for (const value of accepted) {
    const output = execFileSync(powershell, args, { env, input: value, encoding: 'utf8',
      windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    assert.match(output, /Sintaxe aceita/); assert.equal(output.includes(value.trim()), false);
  }
  for (const value of refused.filter(item => item.length > 0)) {
    const result = spawnSync(powershell, args, { env, input: value, encoding: 'utf8', windowsHide: true });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout.includes('Sintaxe aceita'), false);
  }
});
