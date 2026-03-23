/**
 * Native capabilities bridge — Capacitor integration.
 *
 * All functions in this module are safe to call from the web browser.
 * They detect whether the app is running inside a Capacitor native shell
 * and gracefully no-op when running in a regular browser tab.
 *
 * This module is the SINGLE entry-point for all native API usage.
 */

import { Capacitor } from '@capacitor/core';

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

/** True when running inside the native iOS/Android shell. */
export function isNative() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Returns 'ios' | 'android' | 'web'. */
export function getPlatform() {
  try {
    return Capacitor.getPlatform();
  } catch {
    return 'web';
  }
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

let _statusBarImport = null;

async function getStatusBar() {
  if (!isNative()) return null;
  if (_statusBarImport) return _statusBarImport;
  try {
    const mod = await import('@capacitor/status-bar');
    _statusBarImport = mod.StatusBar;
    return _statusBarImport;
  } catch {
    return null;
  }
}

/** Set status bar to dark content (light background). */
export async function setStatusBarDark() {
  const sb = await getStatusBar();
  if (!sb) return;
  try {
    await sb.setStyle({ style: 'DARK' });
  } catch { /* ignore */ }
}

/** Set status bar to light content (dark background). */
export async function setStatusBarLight() {
  const sb = await getStatusBar();
  if (!sb) return;
  try {
    await sb.setStyle({ style: 'LIGHT' });
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Splash screen
// ---------------------------------------------------------------------------

/** Hide the native splash screen. Call after the app's first meaningful paint. */
export async function hideSplashScreen() {
  if (!isNative()) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------

let _hapticsImport = null;

async function getHaptics() {
  if (!isNative()) return null;
  if (_hapticsImport) return _hapticsImport;
  try {
    const mod = await import('@capacitor/haptics');
    _hapticsImport = mod.Haptics;
    return _hapticsImport;
  } catch {
    return null;
  }
}

/** Light haptic tap — e.g. toggling a switch, tapping a nav item. */
export async function hapticLight() {
  const h = await getHaptics();
  if (!h) return;
  try {
    await h.impact({ style: 'LIGHT' });
  } catch { /* ignore */ }
}

/** Medium haptic tap — e.g. confirming an action, successful save. */
export async function hapticMedium() {
  const h = await getHaptics();
  if (!h) return;
  try {
    await h.impact({ style: 'MEDIUM' });
  } catch { /* ignore */ }
}

/** Success haptic notification. */
export async function hapticSuccess() {
  const h = await getHaptics();
  if (!h) return;
  try {
    await h.notification({ type: 'SUCCESS' });
  } catch { /* ignore */ }
}

/** Error/warning haptic notification. */
export async function hapticError() {
  const h = await getHaptics();
  if (!h) return;
  try {
    await h.notification({ type: 'ERROR' });
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

/**
 * Trigger the native share sheet. Falls back to navigator.share in the browser.
 * @param {{ title?: string, text?: string, url?: string, dialogTitle?: string }} opts
 * @returns {Promise<boolean>} true if the share dialog was shown.
 */
export async function nativeShare({ title, text, url, dialogTitle } = {}) {
  if (isNative()) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text, url, dialogTitle: dialogTitle || title });
      return true;
    } catch {
      return false;
    }
  }
  // Web fallback: navigator.share (works in Safari, Chrome on HTTPS).
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch {
      return false; // User cancelled or unsupported
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Keyboard (iOS-specific helpers)
// ---------------------------------------------------------------------------

/** Configure native keyboard behaviour. Call once during app init. */
export async function configureKeyboard() {
  if (!isNative()) return;
  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    // Show the "Done" accessory bar above the keyboard on iOS.
    await Keyboard.setAccessoryBarVisible({ isVisible: true });
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/**
 * Subscribe to native network status changes.
 * @param {(status: { connected: boolean, connectionType: string }) => void} callback
 * @returns {Promise<() => void>} Unsubscribe function.
 */
export async function onNetworkStatusChange(callback) {
  if (!isNative()) {
    // Browser fallback: use navigator.onLine events
    const handler = () => callback({ connected: navigator.onLine, connectionType: 'unknown' });
    window.addEventListener('online', handler);
    window.addEventListener('offline', handler);
    return () => {
      window.removeEventListener('online', handler);
      window.removeEventListener('offline', handler);
    };
  }
  try {
    const { Network } = await import('@capacitor/network');
    const listener = await Network.addListener('networkStatusChange', (status) => {
      callback({ connected: status.connected, connectionType: status.connectionType });
    });
    return () => { try { listener.remove(); } catch { /* ignore */ } };
  } catch {
    return () => {};
  }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

/**
 * Subscribe to app state changes (foreground/background).
 * @param {(state: { isActive: boolean }) => void} callback
 * @returns {Promise<() => void>} Unsubscribe function.
 */
export async function onAppStateChange(callback) {
  if (!isNative()) {
    // Browser fallback: use visibility change
    const handler = () => callback({ isActive: document.visibilityState === 'visible' });
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }
  try {
    const { App } = await import('@capacitor/app');
    const listener = await App.addListener('appStateChange', (state) => {
      callback({ isActive: state.isActive });
    });
    return () => { try { listener.remove(); } catch { /* ignore */ } };
  } catch {
    return () => {};
  }
}

/**
 * Handle the hardware back button (Android).
 * @param {() => void} callback
 * @returns {Promise<() => void>} Unsubscribe function.
 */
export async function onBackButton(callback) {
  if (!isNative() || getPlatform() !== 'android') return () => {};
  try {
    const { App } = await import('@capacitor/app');
    const listener = await App.addListener('backButton', callback);
    return () => { try { listener.remove(); } catch { /* ignore */ } };
  } catch {
    return () => {};
  }
}

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

/**
 * Request push notification permission and register for push.
 * @param {{ onToken: (token: string) => void, onNotification: (data: any) => void, onAction: (data: any) => void }} handlers
 * @returns {Promise<boolean>} true if push was registered successfully.
 */
export async function initPushNotifications({ onToken, onNotification, onAction } = {}) {
  if (!isNative()) return false;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return false;

    await PushNotifications.register();

    if (typeof onToken === 'function') {
      PushNotifications.addListener('registration', (token) => {
        try { onToken(token.value); } catch { /* ignore */ }
      });
    }

    PushNotifications.addListener('registrationError', (err) => {
      console.warn('[PeoplePower] Push registration failed:', err);
    });

    if (typeof onNotification === 'function') {
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        try { onNotification(notification); } catch { /* ignore */ }
      });
    }

    if (typeof onAction === 'function') {
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        try { onAction(action.notification?.data || {}); } catch { /* ignore */ }
      });
    }

    return true;
  } catch (e) {
    console.warn('[PeoplePower] Push notifications unavailable:', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Browser (open external links)
// ---------------------------------------------------------------------------

/**
 * Open a URL in the native in-app browser (or system browser).
 * Falls back to window.open in the web.
 * @param {string} url
 */
export async function openExternalUrl(url) {
  if (isNative()) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return;
    } catch { /* fall through to web */ }
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch { /* ignore */ }
}
