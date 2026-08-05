/** Prefix an internal path with the configured base (for GitHub Pages project hosting). */
export function url(path: string = '/'): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL.slice(0, -1)
    : import.meta.env.BASE_URL;
  return `${base}${path}`;
}

export const NAV_LINKS = [
  { href: '/seasons/', label: 'The Seasons' },
  { href: '/events/', label: 'Events' },
  { href: '/market/', label: 'The Market' },
] as const;

export const SEASONS = {
  spring: { name: 'Spring', signature: 'Discovery', slug: 'spring' },
  summer: { name: 'Summer', signature: 'Gathering', slug: 'summer' },
  autumn: { name: 'Autumn', signature: 'Tradition', slug: 'autumn' },
  holiday: { name: 'Holiday', signature: 'Celebration', slug: 'holiday' },
} as const;

export type SeasonKey = keyof typeof SEASONS;
