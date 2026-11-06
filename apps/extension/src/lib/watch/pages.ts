import { InstagramPostCodeSchema, type InstagramPostCode } from '@impera/contracts';

/**
 * The pages of instagram.com the watch reads (VEI-02, ADR 0060 § 2, source 6), from the path alone. Anything else is
 * never read: the home feed `/`, messages, stories, account settings, and any page not named here.
 */
export type WatchPage =
  /** The Reels feed: the address names the reel on screen, `/reels/<code>/`. */
  | { readonly kind: 'reels'; readonly code: InstagramPostCode | null }
  /** One post or one reel, opened on its own or over a grid: `/p/<code>/`, `/reel/<code>/`. */
  | { readonly kind: 'post'; readonly code: InstagramPostCode; readonly path: 'post' | 'reel' }
  | { readonly kind: 'explore' }
  /** A profile's grid; `reels` is its Reels tab, the one place its views show. */
  | { readonly kind: 'profile'; readonly handle: string; readonly tab: 'posts' | 'reels' };

/** First segments that are Instagram's own pages, never a profile. */
const RESERVED = new Set([
  'about',
  'accounts',
  'api',
  'challenge',
  'developer',
  'direct',
  'emails',
  'explore',
  'legal',
  'oauth',
  'p',
  'privacy',
  'reel',
  'reels',
  'session',
  'stories',
  'tv',
  'web',
]);

const HANDLE = /^[A-Za-z0-9._]{1,30}$/u;

function codeOf(segment: string | undefined): InstagramPostCode | null {
  if (segment === undefined) return null;
  const parsed = InstagramPostCodeSchema.safeParse(segment);
  return parsed.success ? parsed.data : null;
}

/** The profile a first path segment names, or null when it is one of Instagram's own pages. */
export function handleOf(segment: string | undefined): string | null {
  if (segment === undefined || !HANDLE.test(segment)) return null;
  return RESERVED.has(segment.toLowerCase()) ? null : segment;
}

export function watchPageOf(pathname: string): WatchPage | null {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  const [first, second, third, fourth] = segments;
  if (first === undefined) return null;
  if (first === 'reels') {
    // `/reels/audio/<id>/` is a sound's page, not the feed.
    if (second === 'audio') return null;
    if (second === undefined) return { kind: 'reels', code: null };
    return third === undefined ? { kind: 'reels', code: codeOf(second) } : null;
  }
  if (first === 'p' || first === 'reel' || first === 'tv') {
    const code = codeOf(second);
    if (code === null || third !== undefined) return null;
    return { kind: 'post', code, path: first === 'p' ? 'post' : 'reel' };
  }
  if (first === 'explore') {
    // `/explore/` only: tags, places and searches are other pages.
    return second === undefined ? { kind: 'explore' } : null;
  }
  const handle = handleOf(first);
  if (handle === null) return null;
  if (second === undefined) return { kind: 'profile', handle, tab: 'posts' };
  if (second === 'reels' && third === undefined) return { kind: 'profile', handle, tab: 'reels' };
  // `/<handle>/p/<code>/` and `/<handle>/reel/<code>/`: a post opened from that profile.
  if ((second === 'p' || second === 'reel') && fourth === undefined) {
    const code = codeOf(third);
    return code === null ? null : { kind: 'post', code, path: second === 'p' ? 'post' : 'reel' };
  }
  return null;
}

/** The post a link of the page points to (`/p/<code>/`, `/reel/<code>/`, `/<handle>/reel/<code>/`), or null. */
export function postOfHref(href: string | null): { code: InstagramPostCode; path: 'post' | 'reel' } | null {
  if (href === null) return null;
  let url: URL;
  try {
    url = new URL(href, 'https://www.instagram.com');
  } catch {
    return null;
  }
  if (url.hostname !== 'www.instagram.com' && url.hostname !== 'instagram.com') return null;
  const page = watchPageOf(url.pathname);
  if (page?.kind === 'post') return { code: page.code, path: page.path };
  if (page?.kind === 'reels' && page.code !== null) return { code: page.code, path: 'reel' };
  return null;
}
