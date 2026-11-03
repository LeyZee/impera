import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // The address the dev server forwards /v1 to, from `.env.development`. It never reaches the bundle: the app always
  // calls `/v1` on its own origin, and in production the web container's nginx forwards it (nginx.conf.template).
  // Outside development (build, preview, tools that load this file) it is absent and the dev proxy is left out.
  const apiTarget = loadEnv(
    mode,
    fileURLToPath(new URL('.', import.meta.url)),
    'VITE_',
  ).VITE_API_PROXY_TARGET;
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    // The API answers under /v1; proxied so that the session cookie stays first-party (same origin).
    server: { port: 5173, proxy: apiTarget === undefined ? undefined : { '/v1': apiTarget } },
  };
});
