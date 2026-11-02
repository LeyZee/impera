import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './index.css';
import { UpdateNotice } from './pwa/UpdateNotice';
import { captureInstallPrompt } from './pwa/install';
import { registerServiceWorker } from './pwa/serviceWorker';
import { startAppearance } from './shell/appearance';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Missing #root element in index.html');
}
startAppearance();
captureInstallPrompt();
registerServiceWorker();
createRoot(root).render(
  <StrictMode>
    <App />
    <UpdateNotice />
  </StrictMode>,
);
