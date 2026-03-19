# C4 Footer Credit — Portable Component

Animated C4 Studios footer-credit badge extracted from [c4studios.com](https://c4studios.com).

## Files

```
c4-footer-credit/
  C4FooterCredit.jsx      ← main component
  c4WordmarkData.js        ← SVG path data for "Studios" letter morphing
  README.md                ← this file
```

## Dependencies

Install these in the target project:

```bash
npm install gsap @gsap/react
```

Peer requirements (already present in any React project):
- `react` ≥ 18.0
- `react-dom` ≥ 18.0

**No other dependencies.** No Tailwind, no router, no theme provider, no icon library.

## Setup

1. Copy the entire `c4-footer-credit/` folder into your project (e.g. `src/components/c4-footer-credit/`)
2. Install `gsap` and `@gsap/react` if not already present
3. Import and use:

```jsx
import C4FooterCredit from './components/c4-footer-credit/C4FooterCredit';
```

## Usage

### Minimal

```jsx
<footer>
  <C4FooterCredit />
</footer>
```

### With options

```jsx
<footer>
  <C4FooterCredit
    href="https://c4studios.com"
    label="Designed with C4 Studios"
    size={48}
    showText={true}
    openInNewTab={true}
    colorScheme="dark"
    className="my-footer-badge"
  />
</footer>
```

### In a typical footer layout

```jsx
<footer style={{ backgroundColor: '#111', padding: '40px 24px' }}>
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
    <div>
      <p style={{ color: '#666', fontSize: '11px' }}>© 2025 Your Company</p>
    </div>
    <C4FooterCredit size={36} label="Designed by C4 Studios" />
  </div>
</footer>
```

### Light background footer

```jsx
<footer style={{ backgroundColor: '#f8f8f8', padding: '40px 24px' }}>
  <C4FooterCredit colorScheme="light" />
</footer>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `href` | `string` | `'https://c4studios.com'` | Link destination |
| `label` | `string` | `'Designed by C4 Studios'` | Credit text shown below logo + used as `aria-label` |
| `size` | `number \| string` | `36` | Logo height in px, or named size: `'small'` (28), `'default'` (36), `'large'` (48), `'xl'` (72) |
| `className` | `string` | `''` | Additional CSS class(es) on the root `<a>` element |
| `openInNewTab` | `boolean` | `true` | Opens link in new tab with `rel="noopener noreferrer"` |
| `showText` | `boolean` | `true` | Show credit text below the logo |
| `colorScheme` | `string` | `'dark'` | `'dark'` \| `'light'` \| `'auto'` — controls logo colour palette |

## Animation Behaviour

The component preserves the full 3-stage progressive animation from the C4 Studios site:

1. **Dormant** (default) — grey C4 mark, "Studios" text hidden
2. **Hover → Mono** — mark darkens, "Studios" letters fade in with stagger
3. **Hover → Colour** — iris bloom on C arc, "4" builds segment-by-segment, letters spring-bounce and morph from upright → italic
4. **Hover → Dormant** — everything reverses back to rest state

Each hover advances one stage. Three hovers complete the full cycle.

### Touch behaviour

- **Quick tap** (<300ms): navigates to href
- **Long press** (≥300ms): plays animation stage, no navigation

### Reduced motion

When `prefers-reduced-motion: reduce` is active, the logo renders in its static dormant state. The link remains fully functional — only animation is suppressed.

## Accessibility

- Renders as a real `<a>` element (keyboard-navigable, screen-reader accessible)
- `aria-label` set from the `label` prop
- `target="_blank"` includes `rel="noopener noreferrer"`
- Respects `prefers-reduced-motion`
- All SVG elements use unique IDs (via `React.useId`) — safe for multiple instances

## Behaviour changes from the C4 site original

| Area | Original (C4Logo.jsx) | Portable (C4FooterCredit.jsx) | Reason |
|------|----------------------|-------------------------------|--------|
| Theme | Uses site-wide `ThemeContext` via `useTheme()` | Internal `colorScheme` prop with `matchMedia` fallback | Removes dependency on host site's theme system |
| Variant | Supports `'mark'` and `'full'` variants | Always renders `'full'` variant | Mark variant is static and not useful for a footer credit |
| Context | Accepts `'header'` or `'footer'` context | Always uses footer colour palette | Component is purpose-built for footer use |
| Wrapper | Renders `<span>`, parent provides `<Link>` | Renders `<a>` with configurable `href` | Self-contained link — no router dependency |
| Credit text | None (added separately in site footer) | Built-in `showText` / `label` props | Convenience for "Designed by" attribution |
| Styling | Uses Tailwind utility classes | Inline styles only | No CSS framework dependency |
| Reduced motion | Not handled | Suppresses animation when `prefers-reduced-motion: reduce` | Accessibility improvement |
| Data files | 3 separate files (source, normalized, aggregator) | Single pre-computed `c4WordmarkData.js` | Fewer files to copy |

**All animation logic, timing, spring physics, SVG paths, and colour values are identical to the original.**
