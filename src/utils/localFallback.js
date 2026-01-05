const truthy = (value) => {
  if (value == null) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

export const allowLocalProfileFallback =
  !!import.meta?.env?.DEV && truthy(import.meta?.env?.VITE_ALLOW_LOCAL_PROFILE_FALLBACK ?? 'false');

export const allowLocalMessageFallback =
  !!import.meta?.env?.DEV && truthy(import.meta?.env?.VITE_ALLOW_LOCAL_MESSAGE_FALLBACK ?? 'false');
