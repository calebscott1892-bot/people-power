// Tutorial / onboarding steps (v3).
// Keep content here (not in components) so it's easy to localize later.

export const tutorialSteps = [
  {
    id: 'what-is-pp',
    section: 'Welcome',
    icon: 'Megaphone',
    title: 'What People Power is for',
    body: [
      'People Power helps communities turn shared concerns into coordinated action.',
      'Use it to discover movements, support them publicly, and track what\u2019s changing over time.',
    ],
  },
  {
    id: 'how-movements-work',
    section: 'Movements',
    icon: 'Flag',
    title: 'How movements work',
    body: [
      'A movement is a public page for an idea, goal, or local effort \u2014 with a description, updates, and ways for people to participate.',
      'Movements are where organizing happens: people can follow, boost, and comment to build momentum and coordinate next steps.',
    ],
  },
  {
    id: 'what-boosting-means',
    section: 'Boosting',
    icon: 'Flame',
    title: 'What boosting means',
    body: [
      'Boosting is a lightweight way to say \u201cthis matters\u201d and help others discover the movement.',
      'Boost counts are a signal of community interest \u2014 not a promise of impact \u2014 and they help surface what people care about right now.',
    ],
  },
  {
    id: 'how-following-helps',
    section: 'Following',
    icon: 'Users',
    title: 'How following connects communities',
    body: [
      'Following a movement keeps you connected as it evolves \u2014 and it helps organizers understand where support is growing.',
      'When many people follow related movements, it becomes easier to connect efforts across cities and communities.',
    ],
  },
  {
    id: 'direct-messages',
    section: 'Messaging',
    icon: 'MessageCircle',
    title: 'Direct Messages',
    body: [
      'Send private, end-to-end encrypted messages to other users directly from their profile or the Messages tab.',
      'Start one-on-one conversations, share ideas, and coordinate privately. Your messages are encrypted so only you and the recipient can read them.',
      'You can accept or decline message requests from people you haven\u2019t spoken to before.',
    ],
  },
  {
    id: 'daily-challenges',
    section: 'Challenges',
    icon: 'Zap',
    title: 'Daily Challenges & Rewards',
    body: [
      'Complete daily challenges to earn points, build streaks, and unlock profile rewards like badges, accents, and post flair.',
      'Challenges refresh regularly and range from community actions to personal growth tasks. The longer your streak, the bigger the bonus!',
      'Spend your points in the Expression Shop to personalise your profile and stand out.',
    ],
  },
  {
    id: 'search-discover',
    section: 'Discover',
    icon: 'Search',
    title: 'Search & Discovery',
    body: [
      'Use the Search tab to find movements, people, and causes that matter to you.',
      'Browse the Leaderboard to see which movements are gaining the most traction in your area and beyond.',
      'Check Notifications to stay up to date with activity on movements you follow.',
    ],
  },
  {
    id: 'safety-reporting',
    section: 'Safety',
    icon: 'Shield',
    title: 'Staying Safe',
    body: [
      'Block or report users and content directly from any profile, post, or comment. Every report is reviewed.',
      'Your account is private by default \u2014 control who sees your activity from Settings.',
      'Read our Community Guidelines and Safety FAQ for tips on staying safe while organising.',
    ],
  },
];

export function getTutorialStepCount() {
  return tutorialSteps.length;
}
