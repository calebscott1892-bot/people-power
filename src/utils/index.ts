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
        TermsOfService: '/terms-of-service',
        ContentPolicy: '/content-policy',
        CommunityGuidelines: '/community-guidelines',
        LegalHub: '/legal-hub',
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