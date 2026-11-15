import {
  AI_BUDGET_DAILY_MAX_MINOR,
  AI_BUDGET_DAILY_MIN_MINOR,
  AI_BUDGET_TREND_WATCH_MAX_MINOR,
  AI_BUDGET_TREND_WATCH_MIN_MINOR,
  type AiBudget,
} from '@impera/contracts';

import { parseAmount } from '@/reports/model';

/** « 20 € », « 0,50 € »: whole euros without cents, a fraction with its two digits. */
export function eurOf(minor: number): string {
  const whole = minor % 100 === 0;
  const text = (minor / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return [text, '€'].join(' ');
}

/** What a field holds as typed: « 20 », « 0,5 ». */
export function typedOf(minor: number): string {
  return (minor / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2, useGrouping: false });
}

export type Field = 'daily' | 'trendWatch';

const BOUNDS: Readonly<Record<Field, { readonly min: number; readonly max: number }>> = {
  daily: { min: AI_BUDGET_DAILY_MIN_MINOR, max: AI_BUDGET_DAILY_MAX_MINOR },
  trendWatch: { min: AI_BUDGET_TREND_WATCH_MIN_MINOR, max: AI_BUDGET_TREND_WATCH_MAX_MINOR },
};

/** « Entre 1 € et 200 € » under each field. */
export function boundsText(field: Field): string {
  return `Entre ${eurOf(BOUNDS[field].min)} et ${eurOf(BOUNDS[field].max)}`;
}

/** The typed amount in cents, or `null` when it is not an amount inside the field's bounds. */
export function amountOf(text: string, field: Field): number | null {
  const minor = parseAmount(text, false, Number.MAX_SAFE_INTEGER);
  if (minor === null) return null;
  return minor >= BOUNDS[field].min && minor <= BOUNDS[field].max ? minor : null;
}

/** What the agent would do if the typed values were saved, said before « Enregistrer ». */
export function consequenceOf(
  budget: AiBudget,
  daily: number | null,
  trendWatch: number | null,
): { readonly tone: 'warn' | 'error'; readonly text: string } | null {
  if (daily !== null && trendWatch !== null && trendWatch > daily) {
    return {
      tone: 'error',
      text: 'Le plafond de veille ne peut pas dépasser le plafond du jour : il est compté dedans.',
    };
  }
  if (daily !== null && budget.spentTodayMinor >= daily) {
    return {
      tone: 'warn',
      text: `${eurOf(budget.spentTodayMinor)} sont déjà dépensés aujourd’hui : dès l’enregistrement, l’agent s’arrête et les chatteurs prennent le relais jusqu’à minuit.`,
    };
  }
  return null;
}

/** The card's second line: the day's spend against the budget, or that it is reached. */
export function todayOf(budget: AiBudget): string {
  if (budget.state === 'reached') {
    return `Plafond du jour atteint (${eurOf(budget.spentTodayMinor)}) : l’agent s’arrête et les chatteurs prennent le relais jusqu’à minuit.`;
  }
  if (budget.state === 'alert') {
    return `Alerte passée : ${eurOf(budget.spentTodayMinor)} dépensés aujourd’hui sur ${eurOf(budget.dailyCapMinor)}.`;
  }
  return `Aujourd’hui : ${eurOf(budget.spentTodayMinor)} dépensés, alerte à ${eurOf(budget.alertAtMinor)}.`;
}
