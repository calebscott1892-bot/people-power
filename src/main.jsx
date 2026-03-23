import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import App from './App.jsx';
import { AuthProvider } from '@/auth/AuthProvider';
import '@/i18n';
import { scrubLegacyCoordinatesFromLocalUserProfiles } from '@/utils/locationPrivacy';
import { createPeoplePowerQueryClient } from '@/lib/queryClient';
import { hideSplashScreen, configureKeyboard, setStatusBarDark } from '@/utils/native';

import './index.css';

// One-time best-effort cleanup for legacy persisted profile coordinates.
try {
  scrubLegacyCoordinatesFromLocalUserProfiles();
} catch {
  // ignore
}

// Native shell init — safe no-ops in the browser.
hideSplashScreen();
configureKeyboard();
setStatusBarDark();

const queryClient = createPeoplePowerQueryClient();

// Centralized auth-expiry handling: clear cached user data on 401/expired sessions.
try {
  window.addEventListener('pp:auth-expired', () => {
    try {
      queryClient.clear();
    } catch {
      // ignore
    }
  });
} catch {
  // ignore (non-browser)
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
