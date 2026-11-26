import { parse } from 'yaml';
import { z } from 'zod';

/**
 * A simulated fan (ADR « fan simulé », Charles 26/11/2026): an invented man, his whole life, how he writes, what turns
 * him on, his money and the days the code makes things happen to him. Nothing real (ADR 0010): the sheets live in
 * `evals/fans/`, written from general traits of how fans write, never from a real fan's words.
 */

const Level = z.int().min(0).max(10);
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u);

/** One stretch of conversation on a simulated day, at her local time. */
const SessionSchema = z
  .object({
    day: z.int().min(1).max(90),
    at: Clock,
    /** His messages in this session at most: he may leave earlier, never later. */
    max_messages: z.int().min(1).max(40),
    /** What the code makes happen to him this day, told to the fan model as a fact of his life. */
    event: z.string().min(1).optional(),
    /** How the session should go for him (« il part dormir vers minuit »), or nothing. */
    note: z.string().min(1).optional(),
    /** His money for her this month is set to this, on his payday or after a bad surprise. */
    money_eur: z.number().nonnegative().optional(),
  })
  .strict();
export type FanSession = z.infer<typeof SessionSchema>;

/** Minutes from the start of day 1, at her local time. */
export function sessionMinute(session: Pick<FanSession, 'day' | 'at'>): number {
  const [hours = 0, minutes = 0] = session.at.split(':').map(Number);
  return (session.day - 1) * 24 * 60 + hours * 60 + minutes;
}

const FanSheetSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/u),
    label: z.string().min(1),
    /** What this fan tests, in a line. */
    tests: z.string().min(1),
    /** His whole life as the fan model reads it: who he is, how he writes, what he wants, what he refuses. */
    sheet: z.string().min(1),
    /** The truth of his card (methode § 2.1): what she should learn, to measure what she did learn. */
    card: z
      .object({
        first_name: z.string().min(1),
        age: z.int().min(18).max(99),
        city: z.string().min(1),
        job: z.string().min(1),
        work: z.string().min(1),
        love: z.string().min(1),
        passions: z.array(z.string().min(1)).min(1),
        /**
         * The one fantasy that drives him (Charles 26/11: « un sniper embusqué »): she should find it, come back to it
         * through the sexting, and pick the script closest to it, or a custom order when none comes close.
         */
        main_fantasy: z.string().min(1),
        /** The scripts of the test catalogue that answer his main fantasy; empty: none does. */
        fantasy_scripts: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/u)).default([]),
        /** What else turns him on, less. */
        fantasies: z.array(z.string().min(1)).default([]),
        /** What cools him down at once. */
        turn_offs: z.array(z.string().min(1)).default([]),
      })
      .strict(),
    start: z
      .object({ desire: Level, trust: Level, annoyance: Level, money_eur: z.number().nonnegative() })
      .strict(),
    /** He pays a waiting step only above these, and with the money: the code decides, not the fan model. */
    buys_from: z.object({ desire: Level, trust: Level }).strict(),
    sessions: z.array(SessionSchema).min(1),
  })
  .strict()
  .refine(
    (sheet) =>
      sheet.sessions.every((session, i) => {
        const previous = sheet.sessions[i - 1];
        return previous === undefined || sessionMinute(session) > sessionMinute(previous);
      }),
    { message: 'sessions in order of day and hour', path: ['sessions'] },
  );
export type FanSheet = z.infer<typeof FanSheetSchema>;

export function parseFanSheet(text: string): FanSheet {
  return FanSheetSchema.parse(parse(text));
}

/** His sheet as the fan model reads it: his life, then the facts of his card, never the code's thresholds. */
export function fanSheetText(sheet: FanSheet): string {
  const { card } = sheet;
  return [
    sheet.sheet.trim(),
    '',
    'Les faits de ta vie (tu ne les donnes que si on te les demande ou si ça vient) :',
    `- Prénom : ${card.first_name}, ${String(card.age)} ans, ${card.city}.`,
    `- Métier : ${card.job}. ${card.work}`,
    `- Vie amoureuse : ${card.love}`,
    `- Passions : ${card.passions.join(', ')}.`,
    `- Ton fantasme, celui qui te rend fou (tu ne le dis qu'en confiance) : ${card.main_fantasy}.`,
    ...(card.fantasies.length > 0 ? [`- Ce qui t'excite aussi : ${card.fantasies.join(' ; ')}.`] : []),
    ...(card.turn_offs.length > 0 ? [`- Ce qui te refroidit : ${card.turn_offs.join(' ; ')}.`] : []),
  ].join('\n');
}
