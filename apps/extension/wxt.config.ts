import { defineConfig } from 'wxt';

// Manifest V3. Host permissions stay limited to Reveal (apps/extension/README.md), over HTTPS only: a session
// captured on plain HTTP could be read on the way (audit de sécurité du 02/11, M3).
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Nirvana',
    description: 'Connecte Reveal à Nirvana.',
    host_permissions: ['https://*.reveal.me/*'],
  },
  // WXT's default dev port is 3000, the API's: under `pnpm dev` the extension took it first and the API never started.
  dev: { server: { port: 3100 } },
});
