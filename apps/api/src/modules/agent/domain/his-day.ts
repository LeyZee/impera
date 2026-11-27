import { normalise } from '@impera/contracts';

/**
 * Her reflex question about his evening or his day (« ta soirée elle donne quoi », passe 3 du 27/11: 8,5 bulles sur
 * 100), asked again when he had already answered it or told it himself. Code reads it in the conversation and tells the
 * voice not to ask again; the `repetition` guard reads it on her answer. French, English, Spanish and Italian.
 */

// His evening or his day, said to him: « ta soirée », « ton soir », « your day », « tu noche », « la tua serata ».
const HIS_DAY =
  /\b((ta|ton) (soiree|journee|soir|aprem|apres[- ]midi|nuit)|your (day|evening|night)|tu (dia|noche|tarde|jornada)|(la )?tua (giornata|serata))\b/;
// What makes it a question, with or without its « ? »: an interrogative word, « et toi », « ça donne quoi ».
const ASKING =
  /(\?|\b(quoi|comment|ca va|ca donne|elle donne|ressemble|se passe|s'?est passee?|alors|et toi|raconte|how|what|how'?s|que tal|como|come|com'?e|cosa|com'?e andata)\b)/;
// The question in one turn of words: « tu fais quoi ce soir », « what are you up to tonight », « che fai stasera ».
const DAY_QUESTION =
  /\b(tu fais quoi (ce soir|de (ta|ton) (soiree|journee|soir))|t'?as fait quoi (aujourd'?hui|de (ta|ton) (journee|soiree))|what are you (up to|doing) tonight|how was (work|today)|que haces (esta noche|hoy)|che fai stasera|com'?e andata oggi)\b/;
// He tells of his evening or his day himself: « ma soirée », « mon aprem », « my day », « mi noche », « la mia serata ».
const HIS_OWN_DAY =
  /\b((ma|mon) (soiree|journee|soir|aprem|apres[- ]midi)|my (day|evening|night)|mi (dia|noche|tarde|jornada)|la mia (giornata|serata))\b/;

/** Her bubble asks him about his evening or his day. */
export function asksHisDay(bubble: string): boolean {
  const text = normalise(bubble);
  return DAY_QUESTION.test(text) || (HIS_DAY.test(text) && ASKING.test(text));
}

/** How far back his answer still counts: the same evening, not a question about another day. */
const SAME_DAY_HOURS = 8;
/** Without dates, the last this-many messages of the conversation. */
const WINDOW = 20;

interface Message {
  readonly fromFan: boolean;
  readonly text: string;
  readonly at?: Date;
}

/**
 * She already asked him about his evening or his day and he wrote after it, or he told it himself, in this stretch of
 * the conversation (the last messages, within the same evening when they are dated): she does not ask again.
 */
export function hisDayAnswered(history: readonly Message[]): boolean {
  const last = history.at(-1)?.at;
  const recent = history
    .slice(-WINDOW)
    .filter(
      (message) =>
        last === undefined ||
        message.at === undefined ||
        last.getTime() - message.at.getTime() < SAME_DAY_HOURS * 3_600_000,
    );
  return recent.some(
    (message, index) =>
      (message.fromFan && HIS_OWN_DAY.test(normalise(message.text))) ||
      (!message.fromFan && asksHisDay(message.text) && recent.slice(index + 1).some((next) => next.fromFan)),
  );
}

/** Said to the voice once he answered (Charles 27/11): never the same question again, in any form. */
export const HIS_DAY_ANSWERED_HINT =
  'elle lui a déjà demandé comment se passe sa soirée ou sa journée et il a répondu, ou il l’a racontée lui-même : elle ne le lui redemande pas, sous aucune forme ; elle rebondit sur ce qu’il en a dit ou parle d’autre chose';
