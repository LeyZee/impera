import { ABSENCE_IN_PAST_UNPROCESSABLE, type CreatorAbsence, type CreatorLimits } from '@impera/contracts';

import { dayMonth } from '@/scheduling/time';

/** Her absence in words: « Absente le 24 nov. », « Absente du 24 nov. au 26 nov. », « en ce moment » when it covers today. */
export function absenceWords(absence: Pick<CreatorAbsence, 'startsOn' | 'endsOn'>, today: string): string {
  const now = absence.startsOn <= today && today <= absence.endsOn;
  if (now)
    return absence.endsOn === today
      ? 'Absente aujourd’hui'
      : `Absente jusqu’au ${dayMonth(absence.endsOn)} inclus`;
  return absence.startsOn === absence.endsOn
    ? `Absente le ${dayMonth(absence.startsOn)}`
    : `Absente du ${dayMonth(absence.startsOn)} au ${dayMonth(absence.endsOn)}`;
}

/**
 * What the chatter reads first of her (Charles, 21/11): her absence now or the next, then what she no longer does. They
 * come before her sheet's lines in « Elle, en trois lignes »: they are newer than the sheet, and the owner updates it.
 */
export function limitLinesOf(limits: CreatorLimits | undefined): readonly string[] {
  if (limits === undefined) return [];
  const lines: string[] = [];
  const next = limits.absences[0];
  if (next !== undefined)
    lines.push(`${absenceWords(next, limits.today)}${next.note === null ? '' : ` : ${next.note}`}`);
  for (const stop of limits.stops) lines.push(`Ne fait plus : ${stop.what}`);
  return lines;
}

/** What a refusal of the server says to her. */
export function refusalWords(code: string): string {
  return code === ABSENCE_IN_PAST_UNPROCESSABLE
    ? 'Une absence se dit à l’avance, ou le jour même.'
    : 'Ça n’a pas été pris. Vérifie les jours et réessaie.';
}
