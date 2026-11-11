import { readFileSync } from 'node:fs';

import { defineConfig } from 'wxt';

/** The manifest's `key`: the public key's DER in base64, read from its PEM file (a public key, not a secret). */
function manifestKey(): string {
  return readFileSync(new URL('./manifest-key.pub.pem', import.meta.url), 'utf8')
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/gu, '')
    .replace(/\s+/gu, '');
}

// Manifest V3 (ADR 0066). Reveal over HTTPS only: a session captured on plain HTTP could be read on the way (audit de
// sécurité du 02/11, M3). The CRM on this computer (localhost) is readable from the install; a deployed CRM asks the
// browser for its own address alone when it is saved in the popup (optional_host_permissions), never every site.
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Impera',
    description: 'Connecte Reveal à Impera.',
    // The public half of a key pair, so the extension keeps one ID wherever its folder lives (ADR 0062 § 8, ADR 0066
    // § 5): chrome.storage survives a move. The private half was never kept: an unpacked extension does not need it.
    key: manifestKey(),
    // alarms: the watch's timers; scripting: its reader, registered once Instagram is allowed; contextMenus: « Marquer
    // ce post pour… » on a post's link (VEI-02); webRequest: the owner's « Sync » reads the bearer of the open Reveal
    // tab's requests to api.reveal.me, only while it waits (P2-01), never the body nor any other site.
    permissions: ['storage', 'activeTab', 'alarms', 'scripting', 'contextMenus', 'webRequest'],
    host_permissions: ['https://*.reveal.me/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    // Instagram is asked at the first « Veille », never at the install (ADR 0060 § 1); `https://*/*` is a deployed CRM.
    optional_host_permissions: ['https://www.instagram.com/*', 'https://*/*'],
    commands: {
      'mark-post': {
        suggested_key: { default: 'Alt+Shift+M' },
        description: 'Marquer le post à l’écran pour la dernière créatrice choisie',
      },
    },
  },
  // The contracts package only declares schemas and constants: what a script does not import is left out of it, so the
  // reader on instagram.com carries the few schemas it parses and not the whole of `@impera/contracts`.
  vite: () => ({
    build: {
      rollupOptions: {
        treeshake: { moduleSideEffects: (id: string) => !id.includes('/packages/contracts/') },
      },
    },
  }),
  // The file the CRM serves at /extension/impera.zip (ADR 0067, apps/web/Dockerfile): one name, whatever the version.
  zip: { artifactTemplate: 'impera.zip' },
  // WXT's default dev port is 3000, the API's: under `pnpm dev` the extension took it first and the API never started.
  dev: { server: { port: 3100 } },
});
