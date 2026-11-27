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
 * Her accounts the voice is given this turn (`<her_accounts>`): only what his messages open, never under care or a
 * trap. The guard still reads her answer: a handle the voice was not given never passes.
 */
export function ownAccountsForVoice(
  handles: OwnAccountHandles | undefined,
  open: OwnAccountsOpen | undefined,
): readonly { readonly platform: OwnAccountPlatform; readonly handle: string }[] {
  if (handles === undefined || open === undefined || open.closed === true) return [];
  return (['instagram', 'tiktok'] as const).flatMap((platform) => {
    const handle = handles[platform];
    return handle !== undefined && open[platform] === true ? [{ platform, handle }] : [];
  });
}
