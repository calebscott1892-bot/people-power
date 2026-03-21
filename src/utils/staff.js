function normalizeEmail(value) {
  const s = value == null ? '' : String(value).trim().toLowerCase();
  return s || null;
}

export function parseEmailList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function getStaffRole(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return 'user';

  const adminEmails = parseEmailList(import.meta?.env?.VITE_ADMIN_EMAILS);
  if (adminEmails.includes(normalized)) return 'admin';

  const modEmails = parseEmailList(import.meta?.env?.VITE_MODERATOR_EMAILS);
  if (modEmails.includes(normalized)) return 'moderator';

  return 'user';
}

export function isAdmin(email) {
  return getStaffRole(email) === 'admin';
}

export function isStaff(email) {
  const role = getStaffRole(email);
  return role === 'admin' || role === 'moderator';
}
