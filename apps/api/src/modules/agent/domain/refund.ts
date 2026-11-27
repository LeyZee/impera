import { normalise } from '@impera/contracts';

/**
 * A refund, as code reads it (ADR 0158 § 48, avenant du 27/11): she never brings it up herself. Only when he asks for
 * one, or for his money back, does she tell him it is done on Reveal, by the platform's own process. She never
 * refunds him nor decides it: that is money outside policy, blocked whatever he asked. Read in French, English,
 * Spanish and Italian, on the normalised text (no accents, lower case, straight apostrophes).
 */

// His request: the refund itself, or his money back with a verb that asks for it.
const ASKS_REFUND = new RegExp(
  [
    // French: « remboursement », « rembourse-moi », « je veux mon argent », « rendez-moi mon fric ».
    '\\brembours\\w*',
    "\\b(rend\\w*|redonn\\w*|recup\\w*|veux|voudrais|exige|reclame)[- ](moi |me |m')?(mon|mes) (argent|fric|thunes?|tunes?|sous|euros|balles)\\b",
    // English: « a refund », « reimburse me », « my money back », « a chargeback ».
    '\\b(refund\\w*|reimburs\\w*|charge ?back)',
    '\\b(my|the) money back\\b',
    '\\breturn (my|the) money\\b',
    // Spanish: « un reembolso », « devuélveme mi dinero », « quiero mi dinero ».
    '\\breembols\\w*',
    '\\b(devuelv\\w*|devolv\\w*|quiero|recuperar) (me )?(mi|el) dinero\\b',
    '\\bmi dinero de vuelta\\b',
    // Italian: « un rimborso », « ridammi i soldi », « rivoglio i miei soldi », « i soldi indietro ».
    '\\brimbors\\w*',
    '\\b(ridammi|ridatemi|restituisci\\w*|rivoglio|riavere) (i miei |i |il mio )?(soldi|denaro)\\b',
    '\\bsoldi indietro\\b',
  ].join('|'),
  'g',
);

// His own debts (« je dois rembourser mon crédit »): no refund asked of her.
const HIS_DEBT =
  /^(\s+\S+){0,2}?\s+(credits?|prets?|dettes?|emprunts?|banque|pote|loans?|debts?|mortgage|prestit[oi]|debit[oi]|mutuo|prestamos?|deudas?|hipoteca)\b/;

// A word that says he does not ask: « je veux pas de remboursement », « I don't want a refund », « non voglio ».
const NEGATION =
  /^(pas|jamais|aucune?|sans|ni|ne|n'\S*|non|no|not|never|\S*n't|dont|wont|nessun[oa]?|senza|mai|nunca|sin|ningun[oa]?|nada)$/;

/** How many words before his request a negation still turns it down (« je ne veux pas être remboursé »). */
const NEGATION_REACH = 4;

// A clause: punctuation, or « mais », « but », « pero » / « però » (« ma » would be French « ma »).
const CLAUSES = /[.!?\n,;:]+|\b(?:mais|but|pero)\b/;

const negated = (clause: string, at: number): boolean =>
  clause
    .slice(0, at)
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(-NEGATION_REACH)
    .some((word) => NEGATION.test(word));

/**
 * His message asks for a refund or for his money back (ADR 0158 § 48, avenant du 27/11): what lets the voice tell him
 * it is done on Reveal. A refused refund (« je veux pas de remboursement ») or his own debt is no request.
 */
export function asksForRefund(fanText: string): boolean {
  return normalise(fanText)
    .split(CLAUSES)
    .some((clause) =>
      [...clause.matchAll(ASKS_REFUND)].some(
        (match) =>
          !negated(clause, match.index) && !HIS_DEBT.test(clause.slice(match.index + match[0].length)),
      ),
    );
}

/**
 * How many of his turns (his messages between two of hers) a refund he asked still counts for (ADR 0158 § 48, avenant
 * du 27/11): this one and the two before, so that her answer to « et comment je fais ? » may still name Reveal.
 */
const REFUND_ASKED_TURNS = 3;

/** He asked for a refund in his last `REFUND_ASKED_TURNS` turns: she may mention it, as done on Reveal. */
export function askedRefundLately(
  history: readonly { readonly fromFan: boolean; readonly text: string }[],
): boolean {
  const turns: string[][] = [];
  let inTurn = false;
  for (let i = history.length - 1; i >= 0 && turns.length <= REFUND_ASKED_TURNS; i -= 1) {
    const message = history[i];
    if (message === undefined) continue;
    if (!message.fromFan) {
      inTurn = false;
    } else if (inTurn) {
      turns.at(-1)?.push(message.text);
    } else {
      turns.push([message.text]);
      inTurn = true;
    }
  }
  return turns.slice(0, REFUND_ASKED_TURNS).some((turn) => turn.some(asksForRefund));
}

// A refund in her words: the word itself, or his money given back without it (« tu récupères ton argent », « je te
// renvoie tes sous », « your money back », « recuperar tu dinero », « riavere i soldi »).
const MENTIONS_REFUND = new RegExp(
  [
    '\\brembours\\w*',
    "\\b(rend\\w*|redonn\\w*|recup\\w*|renvoi\\w*|renverr\\w*|recev\\w*|recoi\\w*) (ton|tes|son|ses|votre|vos|l'|de l') ?(argent|fric|sous|thunes?|tunes?|euros|balles)\\b",
    '\\b(refund\\w*|reimburs\\w*|charge ?back)',
    '\\b(your|the|his) money back\\b',
    '\\b(get|give|send|return|recover)\\w* (you )?(your|the|his) money\\b',
    '\\breembols\\w*',
    '\\breintegr\\w*',
    '\\bdevoluci\\w*',
    '\\b(devolv\\w*|devuelv\\w*|recuper\\w*|recib\\w*) (tu|el|su) dinero\\b',
    '\\b(tu|el|su) dinero de vuelta\\b',
    '\\brimbors\\w*',
    '\\b(restitu\\w*|rid\\w*|riav\\w*|recuper\\w*|riceve\\w*|rimand\\w*) (i tuoi |i |il tuo )?(soldi|denaro)\\b',
    '\\bsoldi indietro\\b',
    // The refund as a pronoun (« on te le rend », « they'll pay you back », « te lo devuelven », « ti li ridanno »).
    '\\bte (le|les) (rend\\w*|renvoi\\w*|renverr\\w*)',
    '\\b(give|send|pay) (it|you|it all) back\\b',
    '\\bte (lo |la )?(devuelv\\w*|devolv\\w*|reembols\\w*)',
    '\\bti (li |lo )?(ridanno|ridiamo|ridaranno|restitu\\w*|rimbors\\w*)',
  ].join('|'),
);

// Where he does the step himself, on Reveal: « ça se demande sur Reveal », « vois avec le support de Reveal », « ask
// Reveal support », « se pide en Reveal », « si chiede su Reveal ».
const HIS_STEP_ON_REVEAL =
  /\bse (demande|fait|passe|reclame|voit)\b|\b(demande|demandes|demander|vois|voir|contacte|contacter|ecris|ecrire|passe par|passer par|reclame|reclamer|signale|signaler)\b|\b(ask|request|contact|reach out|check with|go through|talk to|write to)\b|\b(it|that)'?s done\b|\bse (pide|solicita|hace|reclama|gestiona)\b|\b(pide|pidelo|pedir|pedirlo|solicita|solicitar|contacta|contactar|escribe|escribir|habla|hablar|reclama|reclamar)\b|\bsi (chiede|richiede|fa)\b|\b(chiedi|chiedilo|chiedere|richiedi|richiedere|contatta|contattare|scrivi|scrivere|parla|parlare)\b/;

// Reveal only as the place or the one he writes to, never as who acts: the word before it.
const BEFORE_REVEAL = new Set([
  'sur',
  'a',
  'au',
  'de',
  'du',
  'avec',
  'chez',
  'par',
  'via',
  'on',
  'through',
  'with',
  'to',
  'from',
  'at',
  'en',
  'con',
  'del',
  'al',
  'su',
  'di',
  'da',
  'tramite',
  'ask',
  'contact',
  'contacte',
  'contacta',
  'contatta',
  'aupres',
]);

// Someone who refunds him, a future, a delay or a certainty: never hers to say. Read on her sentence, closed by
// default. « on » is a subject unless it is the English « on Reveal ».
const REFUNDER_OR_PROMISE = new RegExp(
  [
    // Who refunds: French, English, Spanish, Italian subjects; Spanish and Italian clitics of a refund done to him.
    "\\b(je|j'\\S*|nous|ils|elles|moi)\\b",
    '\\bon (?!reveal\\b)',
    "\\bi (will|can|could|would|am|have|get|give|send|refund|ask|take|make|do)\\b|\\bi'(ll|m|ve|d)\\b",
    "\\b(we|we'll|we're|we've|they|they'll|they're|they've)\\b",
    '\\b(yo|nosotros|nosotras|ellos|ellas|io|noi|loro)\\b',
    '\\bte (van|vamos|voy|reembols\\w*|devuelv\\w*|devolv\\w*|mando|envio|doy)\\b',
    '\\bti\\b',
    '\\b(faccio|restituisco|rimborsiamo|ridiamo)\\b',
    // A future.
    '\\b(vais|vas|va|vont|allons|allez)\\b',
    '\\b(rembourser|rendr|recuperer|recevr|renverr|ser|aur|pourr|devr|fer|ir)(ai|as|a|ons|ez|ont)\\b',
    "\\b(will|shall|going to|gonna)\\b|'ll\\b",
    '\\b(reembolsar|devolver|recuperar|tendr|recibir|podr)(a|as|e|emos|an)\\b',
    '\\b(rimborser|restituir|avr|riavr|recuperer|ricever|sar|potr)(a|ai|o|emo|anno)\\b',
    // A delay.
    "\\b(demain|bientot|vite|rapidement|tout de suite|aujourd'hui|ce soir|d'ici|immediatement|direct)\\b",
    '\\b(sous|dans|in|en|within|entro|tra|fra) \\d+',
    '\\b\\d+ ?(h|heures?|jours?|j|hours?|days?|horas?|dias?|ore|giorni)\\b',
    '\\b(tomorrow|soon|quickly|right away|asap|today|tonight|within|manana|pronto|enseguida|hoy|domani|presto|subito|oggi)\\b',
    // A certainty.
    "\\b(c'est sur|bien sur|pour sur|surement|promis|promets|garanti\\w*|forcement|certaine?|certainement|evidemment|sans souci|sans probleme|aucun doute)\\b",
    '\\b(sure|surely|for sure|definitely|certainly|guarantee\\w*|promise\\w*|of course)\\b',
    '\\b(seguro|seguramente|garantizad\\w*|prometo|claro|sicuro|sicuramente|garantit\\w*|prometto|certo)\\b',
  ].join('|'),
);

/** A refund she only echoes (« le remboursement ? », « pour le refund. »): read with the sentence after it. */
const ECHO_WORDS = 3;

const sentencesOf = (text: string): string[] => {
  const sentences: string[] = [];
  let carried = '';
  for (const sentence of text.split(/[.!?\n]+/)) {
    const joined = `${carried} ${sentence}`.trim();
    if (joined === '') continue;
    const words = joined.split(/\s+/).length;
    carried = MENTIONS_REFUND.test(joined) && words <= ECHO_WORDS ? joined : '';
    if (carried === '') sentences.push(joined);
  }
  if (carried !== '') sentences.push(carried);
  return sentences;
};

/** Her sentence sends him to Reveal, where he asks himself, with no one who refunds, no future, delay or certainty. */
function pointsHimToReveal(sentence: string): boolean {
  const words = sentence.split(/\s+/);
  const revealAt = words.flatMap((word, i) => (/^reveal\b/.test(word) ? [i] : []));
  return (
    revealAt.length > 0 &&
    revealAt.every((i) => BEFORE_REVEAL.has((words[i - 1] ?? '').replace(/^\W+|\W+$/g, ''))) &&
    HIS_STEP_ON_REVEAL.test(sentence) &&
    !REFUNDER_OR_PROMISE.test(sentence)
  );
}

/**
 * What a refund in her draft is (ADR 0158 § 48, avenant du 27/11, réserve de la Sécurité sur #1073), closed by default:
 * a sentence that speaks of a refund passes only when it sends him to Reveal, where he does the step himself (« ça se
 * demande sur Reveal »), with no one who refunds (je, on, nous, Reveal, ils…), no future, no delay and no certainty.
 * Any other is a `promise` (« on te remboursera », « je te renvoie tes sous », « satisfait ou remboursé »). « Je te
 * rembourse pas » is one too, on purpose: she decides a refund neither way. A sentence that passes is still `unasked`
 * when he did not ask; `null`: no refund, or one he asked for, sent to Reveal.
 */
export function refundInDraft(
  bubbles: readonly string[],
  fanAskedRefund: boolean,
): { readonly kind: 'promise' | 'unasked'; readonly match: string } | null {
  const mentioning = sentencesOf(normalise(bubbles.join('\n'))).filter((s) => MENTIONS_REFUND.test(s));
  const promised = mentioning.find((sentence) => !pointsHimToReveal(sentence));
  if (promised !== undefined) return { kind: 'promise', match: promised.trim() };
  const mentioned = mentioning[0];
  return mentioned !== undefined && !fanAskedRefund ? { kind: 'unasked', match: mentioned.trim() } : null;
}
