export function getInteractionErrorMessage(error, fallback) {
  const codeRaw = error && typeof error === 'object' && 'code' in error ? String(error.code || '').trim() : '';
  if (codeRaw === 'USER_BLOCKED') return "You can't interact with this account.";

  const message = String(error?.message || '').trim();
  if (/can't interact with this account/i.test(message)) return "You can't interact with this account.";

  return message || String(fallback || 'Something went wrong.');
}
