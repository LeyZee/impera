/**
 * A number from 10 to 17 read as a possible age (ADR 0168 § 4): what the safety net and the per-sentence reading of
 * his language share, so that both exclude the same hours, sums, measures, ranks and counts. Read on `normalise`d
 * text. Pure, no import.
 */

// The unit of an age in the covered languages.
export const UNIT = '(?:anni|anos|ans?|years?|yrs?|yo|y\\/o)\\b';
// Not his age: « di esperienza », « de casado », « of experience », « fa » (ago). « De edad », « di età », « of age »
// are.
export const NOT_AGE_ANY = "di (?!eta)|d'|de (?!edad)|d |che |que |qu'|of (?!age)|since |ago\\b|fa\\b";

/**
 * A number from 10 to 17 that is not a thing (ADR 0168 § 4): not an hour, a sum, a measure, a rank, a count of
 * objects, nor years of something else (« 15h », « 15 € », « 15 cm », « 15/20 », « 15 photos », « 16 anni di
 * esperienza »).
 */
export const TEEN_NOT_A_THING =
  '\\b1[0-7]\\b' +
  '(?![.,:/\\-]?\\d)(?!\\s*(?:h\\b|h\\d|%|€|\\$|£|°|x\\b|e\\b|eme\\b|er\\b|th\\b|st\\b|' +
  '(?:min|mins|minut\\w*|sec\\w*|s|cm|mm|m|km|kg|g|l|ml|cl|euros?|eur|dollars?|usd|bucks|pounds?|zl\\w*|' +
  'reais|lei|kr|chf|hours?|heures?|ore|horas?|uhr|stunden?|godz\\w*|jours?|days?|giorni|dias|tage|fois|times|' +
  'volte|veces|mal|pages?|photos?|pics?|videos?|messages?|followers?|likes?)\\b))' +
  // Years of something else, not his age: « 16 anni di esperienza », « 15 años de casado ».
  `(?!\\s*${UNIT}\\s*(?:${NOT_AGE_ANY}))`;

/**
 * A bare number from 10 to 17 in a message whose language the guards do not read (ADR 0168 § 4, closed by default):
 * without a word of his language to say it is an age, it is one until a human says otherwise.
 */
export const BARE_TEEN = new RegExp(
  '(?<![\\d.,:/+\\-x#€$£])' +
    '(?<!\\b(?:a|at|alle|alla|a las|las|um|vers|top|no|nr|n|num|numero|page|p|dans|in|tra|fra|en|entre|between|' +
    'after|apres|dopo|despues|until|avant|before)\\s)' +
    TEEN_NOT_A_THING,
  'u',
);

// The months of the covered languages, read on normalised text (« décembre » reads « decembre »).
const MONTHS =
  '(?:janv\\w*|fevr\\w*|mars|avril|mai|juin|juil\\w*|aout|sept\\w*|oct\\w*|nov\\w*|dec\\w*|' +
  'gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|' +
  'enero|febrero|abril|mayo|junio|julio|septiembre|octubre|noviembre|diciembre|' +
  'jan\\w*|feb\\w*|march|apr\\w*|may|june?|july?|aug\\w*)';

/**
 * A bare number from 10 to 17 that is not a date either (27/11): not after « le », « du », « au » and their cousins
 * (« le 15 », « du 12 au 15 », « el 15 », « the 15 »), not before or after a month (« 12 décembre », « dec 15 »).
 * « 15/12 » is already excluded by `TEEN_NOT_A_THING`. What a short sentence needs to count as not covered.
 */
export const BARE_TEEN_NOT_A_DATE = new RegExp(
  `(?<!\\b(?:le|du|au|des|el|il|al|del|dal|dalle|the|on|from|to|${MONTHS})\\s)` +
    BARE_TEEN.source +
    `(?!\\s*(?:au|al|a|to|-)\\s*\\d)(?!\\s*${MONTHS}\\b)`,
  'u',
);

/**
 * Her question about his age, in the covered languages (« t'as quel âge ? », « how old are you », « quanti anni hai »,
 * « cuántos años tienes »): a bare number in his answer is his age. On normalised text.
 */
export const HER_AGE_QUESTION =
  /\b(?:quel age|ton age|how old|your age|quanti anni|che eta|cuantos anos|que edad|tu edad)\b/u;
