import type { Capitalization, GuardCode, MarkSpacing, VoiceFormSettings } from '@impera/contracts';

/**
 * The form of her bubbles (Charles 26/11, ADR 0158 § O): deterministic code, applied to what the voice wrote once the
 * guards have read it and before the send, never to a bubble the code writes itself (the help bubble of care mode is
 * added after). Generic, for any creator: her persona sets each rule, else her agency's base style, else the default
 * here.
 */
export interface FormSettings {
  readonly capitalization: Capitalization;
  readonly stripFinalPeriod: boolean;
  readonly markSpacing: MarkSpacing;
}

export const DEFAULT_FORM_SETTINGS: FormSettings = {
  capitalization: 'free',
  stripFinalPeriod: true,
  markSpacing: 'free',
};

/** One final « . » (spaces after it too), never one of « ... » nor « … ». */
const FINAL_PERIOD = /(?<![.…])\.\s*$/u;

function capitalized(bubble: string, capitalization: Capitalization): string {
  if (capitalization === 'free') return bubble;
  const start = bubble.length - bubble.trimStart().length;
  const first = bubble.charAt(start);
  if (!/\p{L}/u.test(first)) return bubble;
  if (capitalization === 'capital') {
    return bubble.slice(0, start) + first.toLocaleUpperCase('fr') + bubble.slice(start + 1);
  }
  // A word in capitals (« OK », « MDR ») keeps them: only a capitalised first letter goes down.
  if (/\p{Lu}/u.test(bubble.charAt(start + 1))) return bubble;
  return bubble.slice(0, start) + first.toLocaleLowerCase('fr') + bubble.slice(start + 1);
}

function spaced(bubble: string, markSpacing: MarkSpacing): string {
  if (markSpacing === 'none') return bubble.replace(/[ \t\u00A0\u202F]+(?=[?!])/gu, '');
  if (markSpacing === 'space') return bubble.replace(/([^\s?!])(?=[?!])/gu, '$1 ');
  return bubble;
}

/** One bubble in her form. */
export function formBubble(bubble: string, settings: FormSettings): string {
  const marks = spaced(bubble, settings.markSpacing);
  const period = settings.stripFinalPeriod ? marks.replace(FINAL_PERIOD, '') : marks;
  return capitalized(period, settings.capitalization);
}

/** Her bubbles in her form, the voice's only. */
export function formBubbles(bubbles: readonly string[], settings: FormSettings): string[] {
  return bubbles.map((bubble) => formBubble(bubble, settings));
}

export interface FormViolation {
  readonly code: GuardCode;
  readonly severity: 'soft';
  readonly bubbleIndex: number;
  readonly match: string;
}

/**
 * What the voice wrote outside her form (`form_rule`), read before the code puts it right: soft, never a rewrite, a
 * trace for the calibration of how often the voice misses it.
 */
export function checkForm(bubbles: readonly string[], settings: FormSettings): FormViolation[] {
  return bubbles.flatMap((bubble, bubbleIndex) =>
    formBubble(bubble, settings) === bubble
      ? []
      : [{ code: 'form_rule', severity: 'soft', bubbleIndex, match: bubble }],
  );
}

/**
 * Her form, layer by layer (ADR 0171): the first layer that sets a rule wins, her persona before her agency's base
 * style, then the code's default. The emoji streak is read the same way.
 */
export function resolveForm(layers: readonly VoiceFormSettings[]): {
  readonly form: FormSettings;
  readonly emojiStreakMax?: number;
} {
  const first = <K extends keyof VoiceFormSettings>(key: K): VoiceFormSettings[K] | undefined =>
    layers.find((layer) => layer[key] !== undefined)?.[key];
  const emojiStreakMax = first('emoji_streak_max');
  return {
    form: {
      capitalization: first('capitalization') ?? DEFAULT_FORM_SETTINGS.capitalization,
      stripFinalPeriod: first('strip_final_period') ?? DEFAULT_FORM_SETTINGS.stripFinalPeriod,
      markSpacing: first('mark_spacing') ?? DEFAULT_FORM_SETTINGS.markSpacing,
    },
    ...(emojiStreakMax !== undefined && { emojiStreakMax }),
  };
}
