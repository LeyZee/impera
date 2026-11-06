import {
  TREND_CAPTION_MAX,
  TREND_HASHTAGS_MAX,
  type InstagramPostCode,
  type TrendMetrics,
} from '@impera/contracts';

import { firstCountIn, parseCount } from './numbers';
import { handleOf, postOfHref, type WatchPage } from './pages';

/**
 * What the watch reads of one post on the page (VEI-02, ADR 0060 § 2, source 6): only what the page already shows,
 * read from the DOM in the extension's isolated world. Never a click (a caption cut by « plus » is kept as shown),
 * never a scroll, never a request, never the media itself. A value the page does not show is null, never 0.
 */
export interface PostSnapshot {
  readonly code: InstagramPostCode;
  readonly path: 'post' | 'reel';
  readonly account: string | null;
  readonly metrics: TrendMetrics;
  readonly caption: string | null;
  readonly hashtags: readonly string[];
  readonly sound: string | null;
  readonly soundId: string | null;
}

/** True when the page gave nothing of the post but its address: the sign that Instagram changed its page. */
export function isEmptySnapshot(snapshot: PostSnapshot): boolean {
  const { views, likes, comments } = snapshot.metrics;
  return (
    snapshot.account === null &&
    snapshot.caption === null &&
    snapshot.sound === null &&
    snapshot.soundId === null &&
    views === null &&
    likes === null &&
    comments === null
  );
}

const BUTTON = 'button, [role="button"]';

/** The text of an element as it shows, without the text of its buttons (« plus », « Suivre », « Traduire »). */
export function shownText(element: Element): string {
  const doc = element.ownerDocument;
  const walker = doc.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
  let text = '';
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const button = node.parentElement?.closest(BUTTON) ?? null;
    if (button !== null && button !== element && element.contains(button)) continue;
    text += node.nodeValue ?? '';
  }
  return text.replace(/\s+/gu, ' ').trim();
}

/** « Ce compte est privé » on a profile: nothing of it is read (ADR 0060 § 2). */
export function isPrivateProfile(doc: Document): boolean {
  return Array.from(doc.querySelectorAll('h1, h2, span')).some((element) =>
    /^(?:ce compte est privé|this account is private|compte privé)\.?$/iu.test(shownText(element)),
  );
}

/** The account of a post: its first link to a profile, the one whose text is the handle if there is one. */
function accountIn(root: Element): string | null {
  const handles = Array.from(root.querySelectorAll('a[href]'))
    .map((link) => ({ link, handle: profileHandleOf(link.getAttribute('href')) }))
    .filter((entry): entry is { link: Element; handle: string } => entry.handle !== null);
  const named = handles.find((entry) => shownText(entry.link) === entry.handle);
  return (named ?? handles[0])?.handle ?? null;
}

function profileHandleOf(href: string | null): string | null {
  if (href === null) return null;
  const match = /^(?:https:\/\/(?:www\.)?instagram\.com)?\/([^/?#]+)\/?(?:[?#].*)?$/u.exec(href);
  return handleOf(match?.[1]);
}

/** The sound of a reel: its link to `/reels/audio/<id>/`, the id from the address, the name as it shows. */
function soundIn(root: Element): { sound: string | null; soundId: string | null } {
  for (const link of Array.from(root.querySelectorAll('a[href*="/reels/audio/"]'))) {
    const id = /\/reels\/audio\/(\d{1,32})(?:\/|$|\?)/u.exec(link.getAttribute('href') ?? '')?.[1] ?? null;
    if (id === null) continue;
    const name = shownText(link).slice(0, 200);
    return { sound: name === '' ? null : name, soundId: id };
  }
  return { sound: null, soundId: null };
}

/**
 * A count shown next to an icon (the heart, the bubble, the play sign): the icon is found by its label, then the first
 * count among what follows it, climbing a few levels from the icon.
 */
function countNearIcon(root: Element, label: RegExp): number | null {
  for (const icon of Array.from(root.querySelectorAll('[aria-label]'))) {
    if (!label.test(icon.getAttribute('aria-label') ?? '')) continue;
    let level: Element | null = icon;
    for (let depth = 0; depth < 4 && level !== null && level !== root; depth += 1) {
      for (let sibling = level.nextElementSibling; sibling !== null; sibling = sibling.nextElementSibling) {
        const count = parseCount(shownText(sibling));
        if (count !== null) return count;
      }
      level = level.parentElement;
    }
  }
  return null;
}

/** A count written in words of its own element (« 1 234 mentions J’aime », « Afficher les 120 commentaires »). */
function countInWords(root: Element, words: RegExp): number | null {
  for (const element of Array.from(root.querySelectorAll('a, span, section, div'))) {
    if (element.children.length > 3) continue;
    const text = shownText(element);
    if (text.length > 60 || !words.test(text)) continue;
    const count = firstCountIn(text);
    if (count !== null) return count;
  }
  return null;
}

const COUNT = String.raw`\d[\d\s,.]*\s?(?:k|m|md)?`;
const LIKES_WORDS = new RegExp(String.raw`^(?:${COUNT})\s*(?:mentions? j[’']aime|j[’']aime|likes?)$`, 'iu');
const COMMENTS_WORDS = new RegExp(
  String.raw`^(?:afficher (?:les )?|voir (?:les )?|view all )?(?:${COUNT})\s*(?:commentaires?|comments?)$`,
  'iu',
);
const VIEWS_WORDS = new RegExp(String.raw`^(?:${COUNT})\s*(?:vues?|views?|lectures?|plays?)$`, 'iu');

const LIKE_ICON = /^(?:j[’']aime|like)$/iu;
const COMMENT_ICON = /^(?:commenter|comment)$/iu;
const VIEW_ICON = /(?:vue|view|lecture|play)/iu;

function metricsIn(root: Element): TrendMetrics {
  return {
    views: countInWords(root, VIEWS_WORDS) ?? countNearIcon(root, VIEW_ICON),
    likes: countInWords(root, LIKES_WORDS) ?? countNearIcon(root, LIKE_ICON),
    comments: countInWords(root, COMMENTS_WORDS) ?? countNearIcon(root, COMMENT_ICON),
  };
}

/**
 * The caption as it shows: the post's heading on a post page, else its longest line of text that is neither a count,
 * the account nor the sound. A caption cut by « plus » stays cut.
 */
function captionIn(root: Element, account: string | null, sound: string | null): Element | null {
  const heading = root.querySelector('h1');
  if (heading !== null && shownText(heading) !== '') return heading;
  let best: Element | null = null;
  let bestLength = 0;
  for (const line of Array.from(root.querySelectorAll('span[dir="auto"], div[dir="auto"]'))) {
    if (line.closest('a[href*="/reels/audio/"]') !== null) continue;
    const text = shownText(line);
    if (text === '' || text === account || text === sound || parseCount(text) !== null) continue;
    if (text.length > bestLength) {
      best = line;
      bestLength = text.length;
    }
  }
  return best;
}

function hashtagsIn(caption: Element | null, text: string | null): readonly string[] {
  const tags = new Set<string>();
  if (caption !== null) {
    for (const link of Array.from(caption.querySelectorAll('a[href*="/explore/tags/"]'))) {
      const raw = /\/explore\/tags\/([^/?#]+)/u.exec(link.getAttribute('href') ?? '')?.[1];
      if (raw === undefined) continue;
      try {
        tags.add(decodeURIComponent(raw).toLowerCase());
      } catch {
        // A malformed escape in a link: that tag is skipped.
      }
    }
  }
  for (const match of (text ?? '').matchAll(/#([\p{L}\p{N}_]{1,99})/gu)) {
    if (match[1] !== undefined) tags.add(match[1].toLowerCase());
  }
  return Array.from(tags).slice(0, TREND_HASHTAGS_MAX);
}

/** One post shown whole (a post page, a reel of the feed, a post opened over a grid). */
export function readPost(
  root: Element,
  post: { code: InstagramPostCode; path: 'post' | 'reel' },
): PostSnapshot {
  const account = accountIn(root);
  const { sound, soundId } = soundIn(root);
  const captionElement = captionIn(root, account, sound);
  const shown = captionElement === null ? '' : shownText(captionElement);
  const caption = shown === '' ? null : shown.slice(0, TREND_CAPTION_MAX);
  return {
    code: post.code,
    path: post.path,
    account,
    metrics: metricsIn(root),
    caption,
    hashtags: hashtagsIn(captionElement, caption),
    sound,
    soundId,
  };
}

/**
 * One tile of a grid (Explorer, a profile): its address, the profile's handle when the grid is a profile's, and its
 * views on a profile's Reels tab, the one place they show.
 */
export function readTile(tile: Element, page: WatchPage): PostSnapshot | null {
  const post = postOfHref(tile.getAttribute('href'));
  if (post === null) return null;
  const onReelsTab = page.kind === 'profile' && page.tab === 'reels';
  return {
    code: post.code,
    path: post.path,
    account: page.kind === 'profile' ? page.handle : null,
    metrics: {
      views: onReelsTab ? (countNearIcon(tile, VIEW_ICON) ?? countInWords(tile, VIEWS_WORDS)) : null,
      likes: null,
      comments: null,
    },
    caption: null,
    hashtags: [],
    sound: null,
    soundId: null,
  };
}

/** The tiles of a grid page: its links to posts, outside any open dialog. */
export function tilesOf(doc: Document): readonly HTMLAnchorElement[] {
  return Array.from(doc.querySelectorAll<HTMLAnchorElement>('main a[href]')).filter(
    (link) => link.closest('[role="dialog"]') === null && postOfHref(link.getAttribute('href')) !== null,
  );
}

/**
 * The element that holds the post on screen: the post opened in a dialog, else the article that links to it, else the
 * page's single article. Null when the page holds none (it is still loading, or Instagram changed it).
 */
export function postRootOf(doc: Document, code: InstagramPostCode): Element | null {
  const dialog = doc.querySelector('[role="dialog"] article');
  if (dialog !== null) return dialog;
  const articles = Array.from(doc.querySelectorAll('article'));
  const linked = articles.find((article) =>
    Array.from(article.querySelectorAll('a[href]')).some(
      (link) => postOfHref(link.getAttribute('href'))?.code === code,
    ),
  );
  if (linked !== undefined) return linked;
  return articles.length === 1 ? (articles[0] ?? null) : null;
}

/**
 * The element that holds one reel of the feed, from its video: the nearest ancestor that also holds its account and
 * its heart. Null when no ancestor does within a few levels.
 */
export function reelRootOf(video: Element): Element | null {
  let level = video.parentElement;
  for (let depth = 0; depth < 10 && level !== null; depth += 1) {
    const hasHeart = Array.from(level.querySelectorAll('[aria-label]')).some((icon) =>
      LIKE_ICON.test(icon.getAttribute('aria-label') ?? ''),
    );
    if (hasHeart && accountIn(level) !== null) return level;
    if (level.tagName === 'MAIN') return null;
    level = level.parentElement;
  }
  return null;
}
