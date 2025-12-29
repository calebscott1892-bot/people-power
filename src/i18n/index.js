import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const STORAGE_KEY = 'peoplepower_lang';

function getInitialLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return String(saved);
  } catch {
    // ignore
  }

  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return String(nav || 'en');
}

export function setLanguage(lang) {
  const next = String(lang || '').trim() || 'en';
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
  return i18n.changeLanguage(next);
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: {
          app_name: 'People Power',

          onboarding: {
            nav: {
              skip: 'Skip',
              back: 'Back',
              skip_tour: 'Skip tour',
              get_started: 'Get Started',
              next: 'Next',
            },
            steps: {
              welcome: {
                title: 'Welcome to People Power! 🎉',
                description: "Join thousands creating real change. Let's get you started.",
              },
              legal: {
                title: 'Important: Know Your Responsibilities',
                description: 'Quick overview of how this platform works and your responsibilities.',
              },
              interests: {
                title: 'What Moves You?',
                description: "Select causes you care about. We'll personalize your experience.",
              },
              movements: {
                title: 'Discover Movements',
                description: 'Explore movements, boost what matters, and follow updates.',
              },
              create: {
                title: 'Start Your Own',
                description: 'Create movements with AI assistance to amplify your impact.',
              },
              collaborate: {
                title: 'Team Up',
                description: 'Invite collaborators, assign tasks, and coordinate action together.',
              },
            },
          },
        },
      },
    },
    lng: getInitialLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    // Keep keys visible until strings are migrated.
    returnNull: false,
    returnEmptyString: false,
  });

export default i18n;
