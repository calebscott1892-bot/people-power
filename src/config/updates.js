// Central registry for "What's New" entries.
// Keep this list ordered from oldest -> newest.

export const updates = [
  {
    version: '2026-01-SoftLaunch',
    date: 'Jan 2026',
    title: 'Stability & soft launch improvements',
    highlights: [
      'Profiles, onboarding/tutorial progress, follows, blocks, and notifications now sync reliably across devices (server-backed with Postgres).',
      'Movement boost counts and engagement numbers are now consistent between the feed and movement pages.',
      'Search no longer silently falls back to saved results while online; saved results are only shown when you\u2019re truly offline.',
      'Profile banners can be positioned so you control which part of the image is shown.',
      'Followers/Following lists and private accounts behave more like Instagram.',
      'Blocking is clearer and managed from Settings, with safer interaction rules across the app.',
      'Email flows (forgot password + email verification) and session behavior have been tightened for better reliability.',
      'New \u201cWhat\u2019s New\u201d banner tracks what you\u2019ve seen per account.',
      'In production, the app surfaces errors when the backend is unavailable rather than silently falling back to local persistence.',
    ],
    details: [
      'Thanks for helping test People Power during early access. This release focused on reliability, privacy, and making profile/social features feel more predictable.',
      'Key backend changes: Postgres is now the source of truth for core persistence. Frontend uses fail-loudly behavior in production.',
    ],
  },
  {
    version: '2026-03-MarchUpdate',
    date: 'Mar 2026',
    title: 'Direct Messages, Daily Challenges & Performance',
    badge: 'NEW',
    highlights: [
      '\ud83d\udcac Direct Messages are now fully live \u2014 send private, end-to-end encrypted messages to anyone on the platform.',
      '\ud83d\udd10 Messages use X25519 encryption \u2014 only you and the recipient can read your conversations.',
      '\ud83c\udf1f Real-time messaging via WebSocket \u2014 messages appear instantly without refreshing.',
      '\u26a1 Daily Challenges are now live in production \u2014 complete challenges, earn points, build streaks, and unlock profile rewards.',
      '\ud83d\udd25 Streak bonuses at milestones: +5 on day 1, +15 on day 3, +40 on day 7, +200 on day 30!',
      '\ud83d\ude80 Major performance improvements \u2014 optimistic UI makes boosts, follows, and social actions feel instant.',
      '\ud83d\udcf1 New Notifications tab in the bottom navigation bar.',
      '\ud83c\udfc6 Leaderboard now uses a proper Trophy icon.',
      '\ud83d\udee1\ufe0f Safety FAQ page is now accessible from the app.',
      '\ud83d\udd27 WebSocket reliability: heartbeat pings, auto-recovery, raised failure threshold.',
      '\ud83d\udc1b Fixed: DM reactions and conversation requests now properly handle errors.',
      '\ud83d\udcdd Tutorial expanded with sections covering DMs, Challenges, Search, and Safety.',
    ],
    details: [
      'This is the biggest feature release since People Power launched. Two major systems that were built but held back are now fully operational.',
      'Direct Messages: The full messaging system \u2014 including end-to-end encryption, message requests, real-time WebSocket delivery, and a WhatsApp-style UI \u2014 is now enabled for all users.',
      'Daily Challenges: The entire challenge system is now backed by real server persistence (Postgres). Complete challenges, track streaks, earn milestone bonuses, and unlock expression rewards.',
      'Performance: Social actions now use optimistic updates \u2014 the UI updates instantly while the server processes in the background.',
      'Navigation: Bottom nav now includes Notifications, Leaderboard uses Trophy icon, and Safety FAQ is wired into the router.',
      'Backend: Four new API endpoints for challenge completions and user stats, with rate limiting, duplicate prevention, and streak tracking server-side.',
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
