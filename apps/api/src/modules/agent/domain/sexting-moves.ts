import { normalise } from '@impera/contracts';

import type { DesireMap } from './fantasy-match';
import type { PlatformScriptView, ScriptRun } from './script-run';

/**
 * The creator's calibration of the sexting (Charles 26/11, ADR 0098 amendement du 26/11): the moments code reads on his
 * message or on her script, so that the voice is told an intention. Nothing here is her wording.
 */

/** A media's intensity, from the softest: the closed tags of the catalogue (`MediaDescription.intensity`). */
const INTENSITY_ORDER: readonly string[] = ['soft', 'suggestive', 'explicit', 'hardcore'];

/**
 * The step of her script with the frankest media, by its closed tags (the last of them on a tie); without tags, the
 * script's last step. `undefined` for a script with no step.
 */
export function peakStepIndex(script: Pick<PlatformScriptView, 'steps'>): number | undefined {
  if (script.steps.length === 0) return undefined;
  let peak: number | undefined;
  let peakRank = -1;
  script.steps.forEach((step, index) => {
    const rank = Math.max(-1, ...(step.carries?.intensities ?? []).map((i) => INTENSITY_ORDER.indexOf(i)));
    if (rank >= 0 && rank >= peakRank) {
      peak = index;
      peakRank = rank;
    }
  });
  return peak ?? script.steps.length - 1;
}

/**
 * He has seen the frankest step of her script: sent free, or paid and bought or opened. Until then, she holds him back
 * when he is about to come (`holdsBackNow`).
 */
export function peakSeen(
  run: Pick<ScriptRun, 'steps'>,
  script: Pick<PlatformScriptView, 'steps'> | undefined,
): boolean {
  if (script === undefined) return false;
  const peak = peakStepIndex(script);
  if (peak === undefined) return false;
  return run.steps.some(
    (step) =>
      step.stepIndex === peak &&
      (step.kind !== 'paid' || step.outcome === 'bought' || step.outcome === 'opened'),
  );
}

/**
 * He came before the end of her script (Charles 26/11): his run was still open when he said so, a paid step waiting or
 * the next one not sent yet. She pouts a little: he did not wait for her, it is an exchange.
 */
export function cameBeforeFinale(stored: Pick<ScriptRun, 'status'> | null): boolean {
  return stored?.status === 'open';
}

// A murmur with nothing in it, on the normalised text: « mmh », « hmm », « mmmh… », « oh », « ah », « hum », « humm ».
const BARE_MURMUR = /^(m+h*|h+m+|hu+m+|mh+m*|o+h*|a+h*|ou+h*)[\s.!?…😏🥵🔥😈💦]*$/u;

/** His message is only a short murmur, nothing said (« mmh »): in the action, she asks him what it means. */
export function isBareMurmur(fanText: string): boolean {
  return BARE_MURMUR.test(normalise(fanText).trim());
}

// He asks for it free, in his words: « gratuit », « offert », « for free », « gratis », « regalo ».
const ASKS_FREE =
  /\b(gratuit|gratuite|gratos|offert|offerte|cadeau|for free|free one|on the house|gratis|in regalo|de regalo|regalamelo|regalame)\b/;

/**
 * He haggles or asks for it free (Charles 26/11): a price objection, or his words asking for something free. In the
 * action she sulks and reminds him she is no market; the price never moves (`discount` holds).
 */
export function haggles(intent: string, fanText: string): boolean {
  return intent === 'price_objection' || ASKS_FREE.test(normalise(fanText));
}

// A fantasy of sharing her with another man, in the generic words of his card.
const OTHER_MAN_FANTASY =
  /\b(candaul\w*|cocu\w*|cuckold\w*|hotwife|partage\w*|un autre (homme|mec)|avec un autre|plan a trois|another (man|guy))\b/;

/** His desire map asks for another man (Charles 26/11): only then may she speak of one in the action. */
export function wantsOtherMan(map: Pick<DesireMap, 'desires'>): boolean {
  return map.desires.some((item) => OTHER_MAN_FANTASY.test(normalise(item)));
}

// He asks for something more in return: « une autre », « en plus », « compense », « another one », « make it up ».
const ASKS_MORE =
  /\b(une autre|un autre|autre chose|en plus|encore une?|compense\w*|dedommag\w*|another one|something else|make it up|un altr[oa]|otr[oa] mas)\b/;

/**
 * He complains of a media he bought and insists for something more (Charles 26/11): another media, something free, a
 * compensation. She sulks, then whines, never angry; never a discount nor a free media.
 */
export function insistsForMore(fanText: string): boolean {
  const text = normalise(fanText);
  return ASKS_FREE.test(text) || ASKS_MORE.test(text);
}
