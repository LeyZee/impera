import { normalise, type FanFlags } from '@impera/contracts';

import type { GuardViolation } from './guards';

/**
 * His sales frozen (`fans.flags.salesFrozen`, ADR 0088 § 2, ADR 0132): nothing is offered, and nothing is promised for
 * later either, since no later sale is decided (eval pass of 27/11: « tu vas devoir patienter un peu avant que je te
 * montre ça »). Money trouble included (Sécurité, relecture de #1083): to a fan short of money, « yes, later » dangles a
 * sale (méthode : « ventes gelées, humain »). That freeze still lifts when he comes back to paid content himself
 * (`offerDecision`): the composer then reads no hold on a turn where an offer goes.
 */
export function salesHeld(flags: FanFlags | undefined): boolean {
  return flags?.salesFrozen !== undefined;
}

/** A time to come: wait, later, another time (FR, EN, ES, IT), on the normalised text. */
const LATER =
  /\b(?:patiente\w*|patience|attendre|attends|attendras|plus tard|bientot|un de ces (?:jours|soirs)|une autre fois|la prochaine fois|un autre (?:jour|soir)|demain|un jour|later|soon|wait\w*|be patient|another (?:time|day|night)|next time|tomorrow|someday|one day|despues|luego|pronto|esper\w*|paciencia|otro dia|la proxima|manana|algun dia|dopo|piu tardi|presto|aspett\w*|pazienza|un altro giorno|la prossima|domani)\b/u;

/**
 * Her offering something of hers: she is the one who shows, sends or has him see or buy it (FR, EN, ES, IT). « tu vas
 * voir » alone is an idiom (« attends tu vas voir, je te raconte »): only with what is hers after it.
 */
const SHE_OFFERS =
  /\b(?:(?:te|t') ?(?:le |la |les |l' ?)?(?:montr\w*|envo\w*|fais (?:voir|decouvrir)|ferai (?:voir|decouvrir))|je (?:te |t' ?)?(?:montr\w*|envo\w*)|tu (?:verras|vas voir|pourras voir|auras) (?:ma |mes |mon |ce que je |ce que j' ?)|(?:show|send)(?:ing)? you|you'll see (?:my |what i )|(?:i'll|i will|gonna|going to) (?:show|send)|te (?:lo |la |los |las )?(?:muestr\w*|mostrar\w*|ensen\w*|mand\w*|envi[oae]\w*)|(?:veras|vas a ver) (?:mi |mis |lo que )|ti (?:lo |la |li |le )?(?:mostr\w*|mand\w*|invi\w*|faccio vedere|faro vedere)|vedrai (?:la mia |il mio |i miei |le mie |quello che )|achet\w*|debloqu\w*|buy|unlock|compra\w*|sblocc\w*)/u;

/** A media named bare: counts only when his last message asked for her content (« envoie-moi une photo de ton chien »). */
const MEDIA_NAMED =
  /\b(?:videos?|photos?|pics?|pictures?|fotos?|contenus?|content|contenido|contenuto|pack)\b/u;

/** Told to wait, alone: read as a promise when he just asked for her content. */
const WAIT_FOR_IT =
  /\b(?:patiente\w*|patience|devoir attendre|faudra attendre|il faut attendre|wait (?:a bit|a little|a while)|have to wait|be patient|paciencia|tendras que esperar|hay que esperar|pazienza|dovrai aspettare)\b/u;

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
 * come blocks in the same sentence as her offering something of hers (« je te montre », « tu verras mes… »), or as a
 * media named bare when his last message asked for her content; « patiente un peu », or asking him what he would like
 * to see, blocks only after such a message. Blocking: the voice writes once more, told why, then a human answers, as
 * every guard of a sale that must not happen (`care_breach`, `price_outside_offer`).
 */
export function checkDeferredSale(bubbles: readonly string[], fanLastMessage?: string): GuardViolation[] {
  const heAsks = fanLastMessage !== undefined && HE_ASKS.test(normalise(fanLastMessage));
  const violations: GuardViolation[] = [];
  bubbles.forEach((bubble, bubbleIndex) => {
    for (const sentence of sentencesOf(bubble)) {
      const offered = SHE_OFFERS.test(sentence) || (heAsks && MEDIA_NAMED.test(sentence));
      const waited = heAsks ? (WAIT_FOR_IT.exec(sentence) ?? WHAT_HE_WANTS.exec(sentence)) : null;
      const match = LATER.test(sentence) && offered ? sentence : waited?.[0];
      if (match !== undefined) {
        violations.push({ code: 'deferred_sale', severity: 'blocking', bubbleIndex, match });
        return;
      }
    }
  });
  return violations;
}
