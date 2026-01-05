const isExplicitTrue = (value) => String(value ?? '').trim().toLowerCase() === 'true';

export const allowLocalProfileFallback =
  !!import.meta?.env?.DEV && isExplicitTrue(import.meta?.env?.VITE_ALLOW_LOCAL_PROFILE_FALLBACK);

export const allowLocalMessageFallback =
  !!import.meta?.env?.DEV && isExplicitTrue(import.meta?.env?.VITE_ALLOW_LOCAL_MESSAGE_FALLBACK);
