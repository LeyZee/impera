import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Logger } from 'wxt';
import { z } from 'zod';

import { WATCH_SCRIPT } from './lib/watch/watch-script';

/*
 * The built extension, checked as the browser gets it (VEI-02 acceptance): Instagram is never asked at the install,
 * nothing of the extension is exposed to its pages, the reader never runs in the page's world, and the reader's bundle
 * holds no call that could reach out, scroll, click or fire an event.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let out = '';
let manifest: Record<string, unknown> = {};
let reader = '';

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'impera-extension-'));
  await build({ root: ROOT, outDir: out, logger: silent() });
  const dir = join(out, 'chrome-mv3');
  manifest = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  reader = readFileSync(join(dir, 'watch.js'), 'utf8');
}, 120_000);

afterAll(() => {
  if (out !== '') rmSync(out, { recursive: true, force: true });
});

function silent(): Logger {
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
}

const mentionsInstagram = (value: unknown): boolean => JSON.stringify(value ?? null).includes('instagram');

describe('the built manifest', () => {
  it('asks Instagram only when « Veille » starts, never at the install', () => {
    expect(manifest['optional_host_permissions']).toContain('https://www.instagram.com/*');
    expect(mentionsInstagram(manifest['host_permissions'])).toBe(false);
    expect(mentionsInstagram(manifest['content_scripts'])).toBe(false);
  });

  it('opens the copilot in the browser’s side panel and puts nothing in Reveal’s page (ADR 0086 § 1)', () => {
    expect(manifest['side_panel']).toEqual({ default_path: 'sidepanel.html' });
    expect(manifest['permissions']).toContain('sidePanel');
    expect(JSON.stringify(manifest['content_scripts'] ?? [])).not.toContain('reveal');
    expect(JSON.stringify(manifest['web_accessible_resources'] ?? [])).not.toContain('reveal');
  });

  it('reads Reveal’s requests for the « Sync », and no other site’s (P2-01)', () => {
    expect(manifest['permissions']).toContain('webRequest');
    expect(manifest['permissions']).not.toContain('webRequestBlocking');
    expect(manifest['host_permissions']).toEqual([
      'https://*.reveal.me/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ]);
  });

  it('exposes no file of the extension to Instagram', () => {
    expect(mentionsInstagram(manifest['web_accessible_resources'])).toBe(false);
    const resources = JSON.stringify(manifest['web_accessible_resources'] ?? []);
    expect(resources.includes('<all_urls>') || resources.includes('*://*/*')).toBe(false);
  });

  it('never puts a script in the page’s own world', () => {
    expect(JSON.stringify(manifest)).not.toContain('MAIN');
    expect(WATCH_SCRIPT.world).toBe('ISOLATED');
    expect(WATCH_SCRIPT.allFrames).toBe(false);
  });

  it('keeps the reader off messages, stories and account pages', () => {
    expect(WATCH_SCRIPT.excludeMatches).toEqual([
      'https://www.instagram.com/direct/*',
      'https://www.instagram.com/stories/*',
      'https://www.instagram.com/accounts/*',
    ]);
  });
});

describe('the reader’s bundle', () => {
  it.each([
    ['fetch', /(?<![\w$.])fetch(?![\w$])|\.fetch(?![\w$])/u],
    ['XMLHttpRequest', /XMLHttpRequest/u],
    ['sendBeacon', /sendBeacon/u],
    ['WebSocket', /\bWebSocket\b/u],
    ['scrollTo', /scrollTo\b/u],
    ['scrollBy', /scrollBy\b/u],
    ['scrollIntoView', /scrollIntoView/u],
    ['.click(', /\.click\s*\(/u],
    ['dispatchEvent', /dispatchEvent/u],
    ['postMessage', /postMessage/u],
    ['window.open', /window\.open\b|(?<![\w$.])open\s*\(/u],
    ['location.assign', /location\.assign/u],
    ['location.replace', /location\.replace/u],
    ['location.reload', /location\.reload/u],
    [
      'a node put in the page',
      /appendChild|insertBefore|insertAdjacent|\.append\(|\.prepend\(|\.after\(|\.before\(|replaceWith|attachShadow/u,
    ],
    ['markup or style written', /innerHTML|outerHTML|document\.write|adoptedStyleSheets|\.style\./u],
    ['code made from text', /(?<![\w$.])eval\s*\(|new Function\s*\(/u],
    ['storage', /chrome\.storage|\.storage\.local|\.storage\.session/u],
  ])('holds no %s', (_name, pattern) => {
    expect(reader).not.toMatch(pattern);
  });
});
