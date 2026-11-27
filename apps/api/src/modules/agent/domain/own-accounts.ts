import { normalise } from '@impera/contracts';

/**
 * Her own accounts, given to a fan (Charles 27/11, ADR 0143 avenant du 27/11, ADR 0126 § 11 bis): her Instagram only
 * when he asks for it (her wishlist in a story highlight, a cam, her Insta itself), her TikTok in a live context. The
 * handles are the owner's, typed in her sheet in the CRM (`agent.rules.own_accounts`): never in the repository. Code
 * decides when one may leave; the guard lets exactly that handle through, nothing that looks like it.
 */

/** Her handles as stored: lower case, no « @ ». */
export interface OwnAccountHandles {
  readonly instagram?: string;
  readonly tiktok?: string;
}

export type OwnAccountPlatform = keyof OwnAccountHandles;

/** Which of her accounts his messages open now, read by code from what he wrote since her last answer. */
export interface OwnAccountsOpen {
  readonly instagram?: boolean;
  readonly tiktok?: boolean;
  /** Care, a trap (ADR 0143 § 16): none of her accounts leaves, whatever he asked or she says. */
  readonly closed?: boolean;
}

// His Instagram ask, in French, English, Spanish and Italian, read on the normalised text.
const NAMES_INSTAGRAM = /\b(insta(gram)?|ig)\b/u;
// A question, or words that ask for hers: « t'as insta ? », « ton insta », « your ig », « dame tu insta », « il tuo
// insta ». « je scrollais insta » asks for nothing.
const ASK_CUE =
  /\?|\b(ton|ta|tes|t'?as|tu as|t'?es sur|tu es sur|donne|file|envoie|c'?est quoi|your|ur|do you have|you have|have you got|what'?s|give|send|tu|tus|tienes|estas en|dame|pasame|cual es|il tuo|la tua|hai|sei su|dammi|mandami|qual e)\b/u;
// Her wishlist, often in a story highlight of her Instagram.
const WISHLIST =
  /\bwish ?lists?\b|\bliste (de |d')?(souhaits|envies|cadeaux)\b|\blista (dei |de )?(desideri|deseos|regalos)\b/u;
// A cam: « une cam », « webcam », « camshow », « en visio », « facetime », « video call », « videollamada »,
// « videochiamata ».
const CAM =
  /\b(web ?)?cams?\b|\bcam ?shows?\b|\bvisio\b|\bfacetime\b|\bvideo ?(call|chat)s?\b|\bvideollamadas?\b|\bvideochiamat[ae]\b/u;
// Her lives: « ton live », « tes lives », « en live », « go live », « en direct », « en vivo », « in diretta ». The
// English verb (« where do you live », « i live in ») is no live.
const LIVE =
  /\b(en|on|in|un|le|les|ton|tes|ta|mes|mon|ma|your|my|a|the|go|going|went|des|del|tu|tus|il tuo|i tuoi|la tua|ce|prochain|dernier) lives?\b|\blive ?streams?\b|\blives\b(?! (in|at|with|near|here|there))|\ben direct\b|\ben (vivo|directo)\b|\bdiretta\b/u;

/** He asks for her Instagram: his wishlist, a cam, or her Insta itself. */
export function asksHerInstagram(fanText: string): boolean {
  const text = normalise(fanText);
  return WISHLIST.test(text) || CAM.test(text) || (NAMES_INSTAGRAM.test(text) && ASK_CUE.test(text));
}

/** A text speaks of her lives. */
export function speaksOfLives(text: string): boolean {
  return LIVE.test(normalise(text));
}

/** What his messages since her last answer open. */
export function ownAccountsOpenedBy(fanTexts: readonly string[]): OwnAccountsOpen {
  return {
    instagram: fanTexts.some(asksHerInstagram),
    tiktok: fanTexts.some(speaksOfLives),
  };
}

// The names of each platform in her words, removed with her handle: « mon insta c'est … » then reads as nothing.
const NETWORK_WORDS: Readonly<Record<OwnAccountPlatform, RegExp>> = {
  instagram: /\b(insta(gram)?|ig)\b/giu,
  tiktok: /\btik ?tok\b/giu,
};

// A word as a handle is typed: letters, digits, dots, underscores, and what would make it a link or an address (« / »,
// « @ » inside, « - »), so « instagram.com/x » or « x@mail.fr » stay one word, never her handle.
const TOKEN = /[\p{L}\p{N}._\-/@]+/gu;

/** The token is exactly her handle: an optional leading « @ », trailing full stops of a sentence, case aside. */
function isHandle(token: string, handle: string): boolean {
  return token.replace(/^@/u, '').replace(/\.+$/u, '').toLowerCase() === handle;
}

const hasHandle = (bubble: string, handle: string): boolean =>
  (bubble.match(TOKEN) ?? []).some((token) => isHandle(token, handle));

/**
 * Her bubbles as the contact guards read them: her own handle, where code opens it now and only that exact handle,
 * taken out with the names of its platform. Anything else (another handle, a link, another network) is left as it was.
 * Instagram is open when he asked for it; TikTok when he spoke of her lives or her answer does.
 */
export function withoutOwnAccounts(
  bubbles: readonly string[],
  handles: OwnAccountHandles | undefined,
  open: OwnAccountsOpen | undefined,
): readonly string[] {
  if (handles === undefined || open?.closed === true) return bubbles;
  const liveNow = open?.tiktok === true || bubbles.some(speaksOfLives);
  const opened: readonly [OwnAccountPlatform, boolean][] = [
    ['instagram', open?.instagram === true],
    ['tiktok', liveNow],
  ];
  let out = bubbles;
  for (const [platform, isOpen] of opened) {
    const handle = handles[platform];
    if (!isOpen || handle === undefined || !out.some((bubble) => hasHandle(bubble, handle))) continue;
    out = out.map((bubble) =>
      bubble
        .replace(TOKEN, (token) => (isHandle(token, handle) ? ' ' : token))
        .replace(NETWORK_WORDS[platform], ' '),
    );
  }
  return out;
}

/**
 * The fixed tokens the voice writes where it gives an account (Sécurité, 27/11): her handle never enters a prompt, so it
 * never reaches the models' journal. Code puts the handle in their place, from her active version.
 */
export const ACCOUNT_TOKENS: Readonly<Record<OwnAccountPlatform, string>> = {
  instagram: '{{son_instagram}}',
  tiktok: '{{son_tiktok}}',
};

const PLATFORMS: readonly OwnAccountPlatform[] = ['instagram', 'tiktok'];

/** Whether code opens this account for her answer: his ask for Instagram; his lives or hers for TikTok. */
function isOpenFor(
  platform: OwnAccountPlatform,
  bubbles: readonly string[],
  open: OwnAccountsOpen | undefined,
): boolean {
  if (open?.closed === true) return false;
  return platform === 'instagram'
    ? open?.instagram === true
    : open?.tiktok === true || bubbles.some(speaksOfLives);
}

/**
 * Her accounts the voice is told it may give this turn (`<her_accounts>`): the platforms his messages open and whose
 * handle the owner typed, never the handle itself; never under care or a trap.
 */
export function openAccountsForVoice(
  handles: OwnAccountHandles | undefined,
  open: OwnAccountsOpen | undefined,
): readonly OwnAccountPlatform[] {
  if (handles === undefined || open === undefined || open.closed === true) return [];
  return PLATFORMS.filter((platform) => handles[platform] !== undefined && open[platform] === true);
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * Her answer with each token of an open account replaced by her handle (`@handle`), from her active version. A token of
 * an account closed now, or with no handle typed, stays as written: the guards block it (`contact_info`), it is never
 * sent as is.
 */
export function resolveAccountTokens(
  bubbles: readonly string[],
  handles: OwnAccountHandles | undefined,
  open: OwnAccountsOpen | undefined,
): readonly string[] {
  let out = bubbles;
  for (const platform of PLATFORMS) {
    const handle = handles?.[platform];
    if (handle === undefined || !isOpenFor(platform, bubbles, open)) continue;
    const token = new RegExp(`@?${escaped(ACCOUNT_TOKENS[platform])}`, 'gu');
    out = out.map((bubble) => bubble.replace(token, `@${handle}`));
  }
  return out;
}

/**
 * A text with her handles put back as their tokens: what reaches a prompt (the conversation, her bio, her notes) or a
 * guard's journaled match never carries them (Sécurité, 27/11).
 */
export function maskOwnHandles(text: string, handles: OwnAccountHandles | undefined): string {
  if (handles === undefined) return text;
  let out = text;
  for (const platform of PLATFORMS) {
    const handle = handles[platform];
    if (handle === undefined) continue;
    out = out.replace(TOKEN, (token) => {
      if (!isHandle(token, handle)) return token;
      const dots = /\.+$/u.exec(token)?.[0] ?? '';
      return `${ACCOUNT_TOKENS[platform]}${dots}`;
    });
  }
  return out;
}
