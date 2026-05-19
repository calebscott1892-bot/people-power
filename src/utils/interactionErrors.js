export function getInteractionErrorMessage(error, fallback) {
  const codeRaw = error && typeof error === 'object' && 'code' in error ? String(error.code || '').trim() : '';
  if (codeRaw === 'USER_BLOCKED') return "You can't interact with this account.";
  if (codeRaw === 'BACKEND_SUSPENDED') return 'The backend service is currently suspended.';
  if (codeRaw === 'BACKEND_HTML_ERROR') return 'The backend returned an invalid error page.';

  const message = String(error?.message || '').trim();
  if (/can't interact with this account/i.test(message)) return "You can't interact with this account.";
  if (/backend service is suspended|service has been suspended/i.test(message)) return 'The backend service is currently suspended.';

  return message || String(fallback || 'Something went wrong.');
}
