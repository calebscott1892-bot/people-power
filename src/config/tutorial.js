// Tutorial / onboarding steps (v2).
// Keep content here (not in components) so it’s easy to localize later.

export const tutorialSteps = [
  {
    id: 'what-is-pp',
    section: 'Welcome',
    title: 'What People Power is for',
    body: [
      'People Power helps communities turn shared concerns into coordinated action.',
      'Use it to discover movements, support them publicly, and track what’s changing over time.',
    ],
  },
  {
    id: 'how-movements-work',
    section: 'Movements',
    title: 'How movements work',
    body: [
      'A movement is a public page for an idea, goal, or local effort — with a description, updates, and ways for people to participate.',
      'Movements are where organizing happens: people can follow, boost, and comment to build momentum and coordinate next steps.',
    ],
  },
  {
    id: 'what-boosting-means',
    section: 'Boosting',
    title: 'What boosting means',
    body: [
      'Boosting is a lightweight way to say “this matters” and help others discover the movement.',
      'Boost counts are a signal of community interest — not a promise of impact — and they help surface what people care about right now.',
    ],
  },
  {
    id: 'how-following-helps',
    section: 'Following',
    title: 'How following connects communities',
    body: [
      'Following a movement keeps you connected as it evolves — and it helps organizers understand where support is growing.',
      'When many people follow related movements, it becomes easier to connect efforts across cities and communities.',
    ],
  },
  {
    id: 'coming-soon',
    section: 'Coming soon',
    title: 'What’s coming soon (like DMs)',
    body: [
      'Direct messages (DMs) are planned, but they’re currently disabled while we focus on safety and reliability.',
      'For now, you can connect via comments and movement collaboration features. We’ll share updates as new features ship.',
    ],
  },
];

export function getTutorialStepCount() {
  return tutorialSteps.length;
}
