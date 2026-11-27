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

// A refund in her words: the word itself, or his money given back.
const MENTIONS_REFUND = new RegExp(
  [
    '\\brembours\\w*',
    "\\b(rend\\w*|redonn\\w*|recup\\w*) (ton|tes|son|ses|votre|l') ?(argent|fric|sous|thunes?)\\b",
    '\\b(refund\\w*|reimburs\\w*|charge ?back)',
    '\\b(your|the|his) money back\\b',
    '\\breembols\\w*',
    '\\bdevoluci\\w*',
    '\\b(devolv\\w*|devuelv\\w*|recuperar) (tu|el|su) dinero\\b',
    '\\b(tu|el) dinero de vuelta\\b',
    '\\brimbors\\w*',
    '\\b(restitu\\w*|ridare|riavere) (i tuoi |i |il tuo )?(soldi|denaro)\\b',
    '\\bsoldi indietro\\b',
  ].join('|'),
);

// She refunds him herself, or decides he will be: never hers to give (money outside policy).
const PROMISES_REFUND = new RegExp(
  [
    // French: « je te rembourse », « je vais te rembourser », « je te rends ton argent », « tu seras remboursé ».
    "\\bje (vais |peux |veux |te promets de )?(te |t'|vous )?rembourse\\w*",
    "\\bje (vais |peux )?(te |vous )?(rends|rendrai|rendre|redonne|redonnerai|redonner) (ton|tes|votre|l') ?(argent|fric|sous)\\b",
    "\\bje (t'|vous )?ai rembourse\\w*",
    '\\bje (te |vous )?(fais|lance|declenche) (un |le |ton |votre )?remboursement\\b',
    '\\b(tu seras|tu vas etre|vous serez) rembourse\\w*',
    // English: « I'll refund you », « I'll give you your money back », « you'll be refunded ».
    "\\bi('ll| will| can|'m going to|'m gonna| am going to| gonna)? (refund you|give you (your|the) money back)\\b",
    "\\bi('ve)? refunded you\\b",
    "\\byou('ll| will) (be|get) refunded\\b",
    // Spanish: « te reembolso », « te devuelvo el dinero », « serás reembolsado ».
    '\\bte (reembols\\w*|voy a reembolsar)',
    '\\bte (devuelvo|devolvere|voy a devolver) (el |tu )?dinero\\b',
    '\\b(seras|vas a ser) reembolsad[oa]\\b',
    // Italian: « ti rimborso », « ti restituisco i soldi », « sarai rimborsato ».
    '\\bti (rimborso|rimborsero|restituisco|ridaro|rido) ?(i |i tuoi )?(soldi)?',
    '\\b(sarai|verrai) rimborsat[oa]\\b',
  ].join('|'),
);

/**
 * What a refund in her draft is (ADR 0158 § 48, avenant du 27/11): `promise` when she refunds him or decides it herself,
 * `unasked` when she speaks of one he did not ask for, `null` otherwise (no refund, or one he asked for, said as done on
 * Reveal).
 */
export function refundInDraft(
  bubbles: readonly string[],
  fanAskedRefund: boolean,
): { readonly kind: 'promise' | 'unasked'; readonly match: string } | null {
  const text = normalise(bubbles.join(' '));
  // « je te rembourse » is first a promise; « je vais te dire » has no refund word and passes.
  const promised = PROMISES_REFUND.exec(text);
  if (promised !== null && MENTIONS_REFUND.test(promised[0])) return { kind: 'promise', match: promised[0] };
  const mentioned = MENTIONS_REFUND.exec(text);
  if (mentioned !== null && !fanAskedRefund) return { kind: 'unasked', match: mentioned[0] };
  return null;
}
