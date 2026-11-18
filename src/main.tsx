import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { markStartup } from './utils/startupTiming';

markStartup('app-code-loaded');

// The installed app keeps its scripts and icons on the phone; pages and data always come from the network.
if ('serviceWorker' in navigator && (import.meta as { env?: { PROD?: boolean } }).env?.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
