import { z } from 'zod';

/**
 * Taux en réel and the rule that opens Automatique (ADR 0019). The thresholds are constants of the code, never
 * settings of a prompt; the server applies them and the screen only shows them.
 */
export const LIVE_TARGET = 0.8;
/** The live rate reads this many decided drafts, newest first. */
export const LIVE_WINDOW = 200;
const MIN_DECIDED = 100;
/** The blind test with the creator passes at this rate « sans retouche », in % (ADR 0019). */
export const BLIND_TEST_TARGET = 80;

const percent = z.number().min(0).max(100);
const count = z.number().int().nonnegative();

/**
 * What keeps Automatique locked (ADR 0019): her active persona, the live rate, the number of decided drafts, the
 * blind test. Each missing condition carries where it stands; the thresholds live on the server only.
 */
export const AutomaticMissingSchema = z.discriminatedUnion('kind', [
  /** She has no active persona version: the agent writes nothing, nothing is proved (recette 28/10, G4). */
  z.object({ kind: z.literal('active_persona') }),
  z.object({ kind: z.literal('live_rate'), value: percent.nullable(), target: percent }),
  z.object({ kind: z.literal('decided_drafts'), value: count, target: count }),
  z.object({ kind: z.literal('blind_test') }),
]);
export type AutomaticMissing = z.infer<typeof AutomaticMissingSchema>;

/** Whether Automatique may open for her, and what is missing when it may not. */
export const AutomaticGateSchema = z.object({ open: z.boolean(), missing: z.array(AutomaticMissingSchema) });
export type AutomaticGate = z.infer<typeof AutomaticGateSchema>;

/**
 * `POST /v1/creators/:id/blind-tests`: the owner records the blind test of the active voice version, with the rate
 * « sans retouche » she got, in % (kept to one decimal). The server stamps the version and the date; the latest test of a version decides.
 */
export const RecordBlindTestBodySchema = z.object({ rate: percent });
export const BlindTestResultSchema = z.object({
  voicePrompt: z.string().min(1),
  voiceModel: z.string().min(1),
  rate: percent,
  passed: z.boolean(),
  recordedAt: z.iso.datetime(),
  automatic: AutomaticGateSchema,
});
export type BlindTestResult = z.infer<typeof BlindTestResultSchema>;

/** A draft a chatter approved or rejected; `asIs` when she sent it without changing a word. */
export interface DecidedDraft {
  readonly asIs: boolean;
}

export interface LiveRateReading {
  /** 0 to 1; undefined before the first decided draft. */
  readonly rate: number | undefined;
  readonly decided: number;
}

/** Drafts approved without an edit among the last 200 decided, newest first, of one creator and voice version. */
export function liveRate(newestFirst: readonly DecidedDraft[]): LiveRateReading {
  const window = newestFirst.slice(0, LIVE_WINDOW);
  const asIs = window.filter((d) => d.asIs).length;
  return { rate: window.length === 0 ? undefined : asIs / window.length, decided: window.length };
}

/** 0 to 1 as a percent with one decimal, as the Dashboard shows it. */
export function asPercent(rate: number | undefined): number | null {
  return rate === undefined ? null : Math.round(rate * 1000) / 10;
}

/**
 * Automatique opens when she has an active persona version, the live rate reaches 80 % on at least 100 decided
 * drafts of it and the blind test passed.
 */
export function automaticGate(input: {
  readonly personaActive: boolean;
  readonly reading: LiveRateReading;
  readonly blindTestPassed: boolean;
}): AutomaticGate {
  const { rate, decided } = input.reading;
  const missing: AutomaticMissing[] = [];
  if (!input.personaActive) missing.push({ kind: 'active_persona' });
  if (rate === undefined || rate < LIVE_TARGET) {
    missing.push({ kind: 'live_rate', value: asPercent(rate), target: LIVE_TARGET * 100 });
  }
  if (decided < MIN_DECIDED) missing.push({ kind: 'decided_drafts', value: decided, target: MIN_DECIDED });
  if (!input.blindTestPassed) missing.push({ kind: 'blind_test' });
  return { open: missing.length === 0, missing };
}
