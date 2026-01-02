import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import App from './App.jsx';
import { AuthProvider } from '@/auth/AuthProvider';
import '@/i18n';
import { scrubLegacyCoordinatesFromLocalUserProfiles } from '@/utils/locationPrivacy';
import { createPeoplePowerQueryClient } from '@/lib/queryClient';
import { SERVER_BASE } from '@/api/serverBase';

import './index.css';

// One-time best-effort cleanup for legacy persisted profile coordinates.
try {
  scrubLegacyCoordinatesFromLocalUserProfiles();
} catch {
  // ignore
}

const queryClient = createPeoplePowerQueryClient();

// One-time startup log to verify production backend base.
// (This is intentionally not DEV-only so it can be checked in production consoles.)
console.log('[PeoplePower] SERVER_BASE =', SERVER_BASE);

// Best-effort connectivity probe (once per page load) so production consoles can
// confirm requests are reaching the Render backend. This does not affect UI.
try {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  fetch(`${SERVER_BASE}/health`, {
    signal: controller.signal,
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
    .then(async (res) => {
      clearTimeout(timeout);
      const text = await res.text().catch(() => '');
      console.log('[PeoplePower] /health', res.status, text ? text.slice(0, 200) : '');
    })
    .catch((e) => {
      clearTimeout(timeout);
      console.warn('[PeoplePower] /health failed', e?.message || e);
    });
} catch {
  // ignore
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
