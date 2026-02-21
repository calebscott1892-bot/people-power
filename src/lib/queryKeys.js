function normalizeEmail(value) {
  const s = String(value || '').trim().toLowerCase();
  return s || null;
}

function normalizeUsername(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.replace(/^@/, '').toLowerCase();
}

function normalizeId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

export const queryKeys = {
  userProfile: {
    // Current user profile (loaded from /me/profile)
    me: (email) => ['userProfile', normalizeEmail(email)],

    // Public profile views (loaded from /profiles/*)
    public: ({ email, username } = {}) => [
      'userProfile',
      normalizeEmail(email),
      normalizeUsername(username),
    ],

    any: () => ['userProfile'],
  },

  blocks: {
    mine: (email) => ['myBlocks', normalizeEmail(email)],
    any: () => ['myBlocks'],
  },

  movements: {
    feed: () => ['movements', 'feed'],
    leaderboard: () => ['movements', 'leaderboard'],

    // NOTE: Keep movement lists under the 'movements' prefix so that broad
    // invalidations like queryClient.invalidateQueries({ queryKey: ['movements'] })
    // refresh Profile lists after deletes.
    mine: (email) => ['movements', 'mine', normalizeEmail(email)],
    mineWithDeleted: (email) => ['movements', 'mine', normalizeEmail(email), 'withDeleted'],
    followed: (email) => ['movements', 'followed', normalizeEmail(email)],
    byUser: (email) => ['userMovements', normalizeEmail(email)],
    participated: (email) => ['participatedMovements', normalizeEmail(email)],

    detail: (id) => ['movement', normalizeId(id)],

    votes: (id) => ['movementVotes', normalizeId(id)],
    followersCount: (id) => ['movementFollowersCount', normalizeId(id)],
    commentsCount: (id) => ['movementCommentsCount', normalizeId(id)],
    comments: (id) => ['comments', normalizeId(id)],
    commentSettings: (id) => ['commentSettings', normalizeId(id)],
    engagementActivity: (id, ownerEmail) => [
      'movementEngagementActivity',
      normalizeId(id),
      normalizeEmail(ownerEmail),
    ],

    anyList: () => ['movements'],
  },

  follows: {
    userFollow: (targetEmail, viewerEmail) => [
      'userFollow',
      normalizeEmail(targetEmail),
      normalizeEmail(viewerEmail),
    ],
    myFollowers: (email) => ['myFollowers', normalizeEmail(email)],
    myFollowingUsers: (email) => ['myFollowingUsers', normalizeEmail(email)],
    userFollowers: (targetEmail, viewerEmail) => [
      'userFollowers',
      normalizeEmail(targetEmail),
      normalizeEmail(viewerEmail),
    ],
    userFollowingUsers: (targetEmail, viewerEmail) => [
      'userFollowingUsers',
      normalizeEmail(targetEmail),
      normalizeEmail(viewerEmail),
    ],
  },
};
