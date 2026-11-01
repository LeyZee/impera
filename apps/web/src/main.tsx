import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './index.css';
import { startAppearance } from './shell/appearance';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Missing #root element in index.html');
}
startAppearance();
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
