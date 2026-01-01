export function createPageUrl(pageName: string) {
    const raw = String(pageName ?? '').trim();
    if (!raw) return '/';

    const [base, query] = raw.split('?');
    const key = (base || '').trim();

    // Special-case legacy links that passed IDs via query strings.
    // Example: createPageUrl(`MovementDetails?id=abc`) -> /movements/abc
    if (key === 'MovementDetails' && query) {
        try {
            const params = new URLSearchParams(query);
            const id = params.get('id');
            if (id) return `/movements/${encodeURIComponent(id)}`;
        } catch {
            // ignore and fall back to default path handling
        }
    }

    // Explicit route map for core navigation
    const ROUTES: Record<string, string> = {
        Home: '/',
        Login: '/login',
        Profile: '/profile',
        CreateMovement: '/create-movement',
        MovementDetails: '/movements/:id',
        DailyChallenges: '/daily-challenges',
        Search: '/search',
        ReportCenter: '/report',
        TermsOfService: '/terms-of-service',
        ContentPolicy: '/content-policy',
        CommunityGuidelines: '/community-guidelines',
        LegalHub: '/legal-hub',
        PrivacyPolicy: '/privacy-policy',
        AdminDashboard: '/admin-dashboard',
        AdminReports: '/admin-reports',
        AdminChallenges: '/admin-challenges',
        AdminIncidentLog: '/admin-incident-log',
        SystemHealth: '/system-health',
        CommunityHealth: '/community-health',
        FeatureFlags: '/feature-flags',
        ResearchConfig: '/research-config',
    };

    const toKebab = (s: string) =>
        s
            .replace(/_/g, '-')
            .replace(/\s+/g, '-')
            .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
            .toLowerCase();

    const path = ROUTES[key] ?? `/${toKebab(key)}`;
    return query ? `${path}?${query}` : path;
}

export function getPageLabel(pathname: string) {
    const clean = String(pathname || '').split('?')[0].replace(/\/+$/, '') || '/';
    const routes: Array<{ pattern: RegExp; label: string }> = [
        { pattern: /^\/$/, label: 'Home' },
        { pattern: /^\/profile$/, label: 'Profile' },
        { pattern: /^\/u\//, label: 'Profile' },
        { pattern: /^\/login$/, label: 'Sign In' },
        { pattern: /^\/create-movement$/i, label: 'Create Movement' },
        { pattern: /^\/movements\/[^/]+$/, label: 'Movement' },
        { pattern: /^\/messages$/, label: 'Messages' },
        { pattern: /^\/daily-challenges$/, label: 'Daily Challenges' },
        { pattern: /^\/leaderboard$/, label: 'Leaderboard' },
        { pattern: /^\/notifications$/, label: 'Notifications' },
        { pattern: /^\/search$/, label: 'Search' },
        { pattern: /^\/report/i, label: 'Report Center' },
        { pattern: /^\/collaboration-invites$/, label: 'Collaboration Invites' },
        { pattern: /^\/legal-hub$/i, label: 'Legal Hub' },
        { pattern: /^\/legalhub$/i, label: 'Legal Hub' },
        { pattern: /^\/terms-of-service$/i, label: 'Terms of Service' },
        { pattern: /^\/termsofservice$/i, label: 'Terms of Service' },
        { pattern: /^\/content-policy$/i, label: 'Content Policy' },
        { pattern: /^\/contentpolicy$/i, label: 'Content Policy' },
        { pattern: /^\/community-guidelines$/i, label: 'Community Guidelines' },
        { pattern: /^\/communityguidelines$/i, label: 'Community Guidelines' },
        { pattern: /^\/privacy-policy$/i, label: 'Privacy Policy' },
        { pattern: /^\/privacy$/i, label: 'Privacy Policy' },
        { pattern: /^\/safety-faq$/, label: 'Safety FAQ' },
        { pattern: /^\/admin-dashboard$/, label: 'Admin Dashboard' },
        { pattern: /^\/admin-reports$/, label: 'Reports' },
        { pattern: /^\/admin-incident-log$/, label: 'Incident Log' },
        { pattern: /^\/admin-challenges$/, label: 'Admin Challenges' },
        { pattern: /^\/system-health$/, label: 'System Health' },
        { pattern: /^\/community-health$/, label: 'Community Health' },
        { pattern: /^\/feature-flags$/, label: 'Feature Flags' },
        { pattern: /^\/research-config$/, label: 'Research Config' },
    ];

    const match = routes.find((route) => route.pattern.test(clean));
    if (match) return match.label;

    const tail = clean.split('/').filter(Boolean).pop() || 'Home';
    return tail
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}
