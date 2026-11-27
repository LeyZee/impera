import { StaircaseSettingSchema, type StaircaseSetting } from '@impera/contracts';

export type StaircaseKey = keyof StaircaseSetting;

/**
 * The agency's settings, in the words the owner reads (ADR 0098, avenant du 27/11/2026). Each is a multiple of a
 * price except the desire score; a field left empty turns its part off.
 */
export const STAIRCASE_FIELDS: readonly (readonly [StaircaseKey, string])[] = [
  ['targetMultiple', 'Cible entre branches (multiple de la dernière étape prise)'],
  ['topTierTargetMultiple', 'Cible pour un gros payeur très chaud (multiple)'],
  ['topTierMinDesire', 'Gros payeur très chaud à partir du désir (0 à 100)'],
  ['startCapMultiple', 'Plafond au lancement (multiple de son plus gros achat)'],
  ['spendBranchJumpMultiple', 'Saut toléré pour une branche selon la dépense (multiple)'],
];

export type StaircaseTexts = Readonly<Record<StaircaseKey, string>>;

const textOf = (value: number | undefined): string =>
  value === undefined ? '' : String(value).replace('.', ',');

export const textsOf = (setting: StaircaseSetting): StaircaseTexts => ({
  targetMultiple: textOf(setting.targetMultiple),
  topTierTargetMultiple: textOf(setting.topTierTargetMultiple),
  topTierMinDesire: textOf(setting.topTierMinDesire),
  startCapMultiple: textOf(setting.startCapMultiple),
  spendBranchJumpMultiple: textOf(setting.spendBranchJumpMultiple),
});

/** A number typed with a comma or a point; `undefined` when empty, `null` when not a number. */
function numberOf(text: string): number | undefined | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return undefined;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** The settings typed, or why they cannot be saved, in his words. Empty fields are left out: that part is off. */
export function settingOf(
  texts: StaircaseTexts,
): { readonly setting: StaircaseSetting } | { readonly problem: string } {
  const entries: [StaircaseKey, number][] = [];
  for (const [key] of STAIRCASE_FIELDS) {
    const value = numberOf(texts[key]);
    if (value === null) return { problem: 'Un nombre par réglage, ou rien pour le couper.' };
    if (value !== undefined) entries.push([key, value]);
  }
  const parsed = StaircaseSettingSchema.safeParse(Object.fromEntries(entries));
  if (!parsed.success)
    return { problem: 'Un multiple au-dessus de 1 (jusqu’à 10), un désir entier de 0 à 100.' };
  return { setting: parsed.data };
}
