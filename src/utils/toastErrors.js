import { toast } from 'sonner';
import { getFriendlyError } from '@/utils/friendlyErrors';
import { getInteractionErrorMessage } from '@/utils/interactionErrors';

function isProbablyTechnical(text) {
  const t = String(text || '').trim();
  if (!t) return false;

  const lower = t.toLowerCase();
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('etimedout') ||
    lower.includes('econn') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('invalid session') ||
    lower.includes('unauthorized session') ||
    lower.includes('auth session missing') ||
    lower.includes('jwt expired') ||
    /\b(typeerror|referenceerror|syntaxerror)\b/i.test(t) ||
    /\b(status\s*\d{3}|http\s*\d{3}|\d{3}\s*(error)?)\b/i.test(t)
  );
}

/**
 * Show an error toast with user-friendly messaging.
 *
 * Priority:
 * 1) Blocked/interaction errors via getInteractionErrorMessage
 * 2) Friendly error classifier (offline/timeout/auth/server)
 * 3) Fallback string
 */
export function toastFriendlyError(error, fallback) {
  const interactionMessage = getInteractionErrorMessage(error, '').trim();
  if (interactionMessage) {
    toast.error(interactionMessage);
    return;
  }

  const friendly = getFriendlyError(error);
  const fb = String(fallback || '').trim();

  // Prefer caller-provided copy if it is already user-friendly.
  if (fb && !isProbablyTechnical(fb)) {
    toast.error(fb);
    return;
  }

  toast.error(friendly.description || friendly.title || 'Something went wrong.');
}
