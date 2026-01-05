// Central registry for "What's New" entries.
// Keep this list ordered from oldest -> newest.

export const updates = [
  {
    version: '2026-01-SoftLaunch',
    date: 'Jan 2026',
    title: 'Stability & soft launch improvements',
    highlights: [
      'Direct Messages are temporarily disabled while we rebuild them. You’ll see a “Messages coming soon” page for now.',
      'Movement boost counts and engagement numbers are now more consistent between the feed and movement pages.',
      'Profile banners can be positioned so you control which part of the image is shown.',
      'Followers/Following lists and private accounts behave more like Instagram, and Momentum is removed from profiles.',
      'Blocking is clearer and managed from Settings, with safer interaction rules across the app.',
      'Email flows (forgot password + email verification) and session behavior have been tightened for better reliability.',
    ],
    details: [
      'Thanks for helping test People Power during early access. These updates focus on reliability, privacy, and making profile/social features feel more predictable.',
    ],
  },
];

export function getLatestUpdateVersion() {
  const last = updates.length ? updates[updates.length - 1] : null;
  return last?.version ? String(last.version) : null;
}

export function hasUnseenUpdate(lastSeenUpdateVersion) {
  const latest = getLatestUpdateVersion();
  if (!latest) return false;
  const seen = lastSeenUpdateVersion ? String(lastSeenUpdateVersion) : null;
  return seen !== latest;
}
