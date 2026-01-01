// Note: Daily Challenges reset at midnight Australian Western Time (UTC+8).
// We derive a day key by shifting Date by +8h and using the UTC date portion.

const AWT_OFFSET_MS = 8 * 60 * 60 * 1000;

export function getAwTimeKey(date = new Date()) {
  const awMillis = date.getTime() + AWT_OFFSET_MS;
  const awDate = new Date(awMillis);
  return awDate.toISOString().slice(0, 10);
}

export function getAwTimeKeyNDaysAgo(daysAgo = 0, date = new Date()) {
  const safeDays = Number.isFinite(Number(daysAgo)) ? Number(daysAgo) : 0;
  const awMillis = date.getTime() + AWT_OFFSET_MS;
  const awDate = new Date(awMillis);
  awDate.setUTCDate(awDate.getUTCDate() - safeDays);
  return awDate.toISOString().slice(0, 10);
}
