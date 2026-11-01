import { defineConfig } from 'wxt';

// Manifest V3. Host permissions stay limited to Reveal (apps/extension/README.md).
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Nirvana',
    description: 'Connecte Reveal à Nirvana.',
    host_permissions: ['*://*.reveal.me/*'],
  },
  // WXT's default dev port is 3000, the API's: under `pnpm dev` the extension took it first and the API never started.
  dev: { server: { port: 3100 } },
});
