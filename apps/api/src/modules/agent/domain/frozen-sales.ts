import { normalise, type FanFlags } from '@impera/contracts';

import type { GuardViolation } from './guards';

/**
 * His sales frozen (`fans.flags.salesFrozen`, ADR 0088 § 2): nothing is offered, and nothing is promised for later
 * either, since no later sale is decided (eval pass of 27/11: « tu vas devoir patienter un peu avant que je te montre
 * ça »). A freeze for money trouble is his own, lifted when he comes back to paid content (`offerDecision`): it is not
 * read here.
 */
export function salesHeld(flags: FanFlags | undefined): boolean {
  const frozen = flags?.salesFrozen;
  return frozen !== undefined && frozen.reason !== 'money_trouble';
}

/** A time to come: wait, later, another time (FR, EN, ES, IT), on the normalised text. */
const LATER =
  /\b(?:patiente\w*|patience|attendre|attends|attendras|plus tard|bientot|un de ces (?:jours|soirs)|une autre fois|la prochaine fois|un autre (?:jour|soir)|demain|un jour|later|soon|wait\w*|be patient|patience|another (?:time|day|night)|next time|tomorrow|someday|one day|despues|luego|pronto|esper\w*|paciencia|otro dia|la proxima|manana|algun dia|dopo|piu tardi|presto|aspett\w*|pazienza|un altro giorno|la prossima|domani)\b/u;

/** Something of hers to see, send or buy: her showing it to him, a media, a purchase (FR, EN, ES, IT). */
const SHOWN =
  /\b(?:(?:te|t') ?(?:le |la |les |l' ?)?(?:montr\w*|envo\w*|fais (?:voir|decouvrir)|ferai (?:voir|decouvrir))|je (?:te |t' ?)?(?:montr\w*|envo\w*)|tu (?:verras|vas voir|pourras voir|auras)|(?:show|send)(?:ing)? you|you'll see|(?:i'll|i will|gonna|going to) (?:show|send)|te (?:lo |la |los |las )?(?:muestr\w*|mostrar\w*|ensen\w*|mand\w*|envi[oae]\w*)|veras|vas a ver|ti (?:lo |la |li |le )?(?:mostr\w*|mand\w*|invi\w*|faccio vedere|faro vedere)|vedrai|videos?|photos?|pics?|pictures?|fotos?|contenus?|content|contenido|contenuto|pack|achet\w*|debloqu\w*|buy|unlock|compra\w*|sblocc\w*)\b/u;

/** Told to wait, alone: read as a promise when he just asked for her content. */
const WAIT_FOR_IT =
  /\b(?:patiente\w*|patience|devoir attendre|faudra attendre|il faut attendre|wait (?:a bit|a little|a while)|have to wait|be patient|patience|paciencia|tendras que esperar|hay que esperar|pazienza|dovrai aspettare)\b/u;

/**
 * Asking him what he would like to see, after he asked for her content: the opening of a sale that cannot come (eval
 * pass of 27/11, « dis moi ce que t'as envie de voir » to a fan whose sales are frozen).
 */
const WHAT_HE_WANTS =
  /\b(?:ce que (?:t' ?as|tu as|tu aurais|tu voudrais) envie de voir|ce que tu (?:veux|voudrais|aimerais) voir|what (?:do )?you(?:'d)? (?:want|like|wanna) (?:to )?see|que (?:quieres|te gustaria) ver|cosa (?:vuoi|vorresti|ti piacerebbe) vedere)\b/u;

/** His asking for her content or paying for it, on the normalised text. */
const HE_ASKS =
  /\b(?:montre\w*|envoie\w*|videos?|photos?|pics?|pictures?|fotos?|contenus?|content|contenido|contenuto|pack|show me|send me|je paie|je paye|payer|i pay|pay|pago|pagare|pago io)\b/u;

/** Her sentences, across her bubbles: a promise is read in one sentence, never across two. */
function sentencesOf(bubble: string): string[] {
  return normalise(bubble)
    .split(/[.!?\n]+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Her sales frozen, a sale promised for later (eval pass of 27/11): read in context, never on a word alone. A time to
 * come blocks with something to see, send or buy in the same sentence; « patiente un peu », or asking him what he
 * would like to see, blocks only when his last message asked for her content. Blocking: the voice writes once more, told why, then a human answers, as every
 * guard of a sale that must not happen (`care_breach`, `price_outside_offer`).
 */
export function checkDeferredSale(bubbles: readonly string[], fanLastMessage?: string): GuardViolation[] {
  const heAsks = fanLastMessage !== undefined && HE_ASKS.test(normalise(fanLastMessage));
  const violations: GuardViolation[] = [];
  bubbles.forEach((bubble, bubbleIndex) => {
    for (const sentence of sentencesOf(bubble)) {
      const later = LATER.exec(sentence);
      const shown = SHOWN.exec(sentence);
      const waited = heAsks ? (WAIT_FOR_IT.exec(sentence) ?? WHAT_HE_WANTS.exec(sentence)) : null;
      const match = later !== null && shown !== null ? sentence : waited?.[0];
      if (match !== undefined) {
        violations.push({ code: 'deferred_sale', severity: 'blocking', bubbleIndex, match });
        return;
      }
    }
  });
  return violations;
}
