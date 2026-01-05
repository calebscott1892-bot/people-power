import { getInteractionErrorMessage } from '@/utils/interactionErrors';

function getErrorString(error) {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    try {
      return String(error.message || '');
    } catch {
      return '';
    }
  }
  return '';
}

function isOffline() {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.onLine !== 'boolean') return false;
  return navigator.onLine === false;
}

/**
 * Maps unknown errors into a small, user-friendly display model.
 *
 * @param {unknown} error
 * @returns {{ kind: 'offline'|'timeout'|'auth'|'blocked'|'server'|'unknown', title: string, description: string }}
 */
export function getFriendlyError(error) {
  const messageRaw = getErrorString(error);
  const message = String(messageRaw || '').trim();
  const lower = message.toLowerCase();

  // Reuse existing blocked/interaction normalization.
  const interactionMessage = getInteractionErrorMessage(error, '').trim();
  if (interactionMessage === "You can't interact with this account.") {
    return {
      kind: 'blocked',
      title: "You can't do that right now.",
      description: "You can't interact with this account.",
    };
  }

  if (
    isOffline() ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('internet disconnected')
  ) {
    return {
      kind: 'offline',
      title: "You're offline.",
      description: 'Check your connection and try again.',
    };
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('etimedout') ||
    lower.includes('econnaborted')
  ) {
    return {
      kind: 'timeout',
      title: 'This is taking longer than expected.',
      description: 'Please try again in a moment.',
    };
  }

  if (
    lower.includes('invalid session') ||
    lower.includes('unauthorized session') ||
    lower.includes('auth session missing') ||
    lower.includes('jwt expired') ||
    /\b(401|403)\b/.test(lower)
  ) {
    return {
      kind: 'auth',
      title: 'Please sign in again.',
      description: 'Your session may have expired.',
    };
  }

  if (/\b(500|502|503|504)\b/.test(lower)) {
    return {
      kind: 'server',
      title: 'Server error.',
      description: 'Please try again in a moment.',
    };
  }

  return {
    kind: 'unknown',
    title: 'Something went wrong.',
    description: 'Please try again.',
  };
}

export function getErrorDetails(error) {
  const msg = getErrorString(error);
  return String(msg || error || 'Unknown error');
}

export function shouldShowErrorDetails() {
  let showDetails = import.meta?.env?.DEV;
  if (showDetails) return true;

  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('debug') === '1' || localStorage.getItem('pp_debug') === '1';
  } catch {
    return false;
  }
}
