import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Logger } from 'wxt';
import { z } from 'zod';

/*
 * The hosted build (ADR 0067, second amendement): the image passes the CRM's address, and the browser gets that site
 * alone at the install, beside the rights every build has. A fictitious address: the real one never enters the repo.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CRM = 'https://crm.exemple.fr';
let out = '';
let manifest: Record<string, unknown> = {};
let bundles = '';

const silent = (): Logger => {
  const quiet = (): void => undefined;
  return {
    debug: quiet,
    log: quiet,
    info: quiet,
    warn: quiet,
    error: quiet,
    fatal: quiet,
    success: quiet,
    level: 0,
  };
};

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'impera-extension-hosted-'));
  process.env['EXTENSION_CRM_ORIGIN'] = CRM;
  try {
    await build({ root: ROOT, outDir: out, logger: silent() });
  } finally {
    delete process.env['EXTENSION_CRM_ORIGIN'];
  }
  const dir = join(out, 'chrome-mv3');
  manifest = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  bundles = [
    readFileSync(join(dir, 'background.js'), 'utf8'),
    ...readdirSync(join(dir, 'chunks')).map((file) => readFileSync(join(dir, 'chunks', file), 'utf8')),
  ].join('\n');
}, 120_000);

afterAll(() => {
  if (out !== '') rmSync(out, { recursive: true, force: true });
});

describe('the hosted build', () => {
  it('is granted its CRM alone at the install, exactly, beside the usual rights', () => {
    expect(manifest['host_permissions']).toEqual([
      'https://*.reveal.me/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
      `${CRM}/*`,
    ]);
    expect(manifest['optional_host_permissions']).toEqual(['https://www.instagram.com/*', 'https://*/*']);
  });

  it('carries the address to the popup and the service worker', () => {
    expect(bundles).toContain(CRM);
  });
});
