import {
  ApiErrorSchema,
  DesireMarksSchema,
  PlaygroundAnswerSchema,
  PlaygroundComparisonSchema,
  PlaygroundRatingResultSchema,
  PlaygroundStateSchema,
  VoiceBankSchema,
  type CreatorId,
  type DesireMarks,
  type DesireMarkVerdict,
  type Destination,
  type PlaygroundComparison,
  type PlaygroundMedia,
  type PersonaVersionId,
  type PlaygroundGuardViolation,
  type PlaygroundPersonaBody,
  type PlaygroundState,
  type Verdict,
  type VoiceBank,
} from '@impera/contracts';
import type { z } from 'zod';

import type { CreatorMedia } from './model';

/**
 * Everything the screen asks of the playground (routes of P3-06 under /v1/playground). Each call that changes
 * the conversation hands back the whole state, so the screen has one source. The demo client answers alone.
 */
export interface PlaygroundClient {
  readonly isDemo: boolean;
  state(): Promise<PlaygroundState>;
  choosePreset(presetId: string): Promise<PlaygroundState>;
  /** Whom she speaks as: a creator's version, active or not, or the invented persona; the conversation starts over. */
  choosePersona(body: PlaygroundPersonaBody): Promise<PlaygroundState>;
  /** Same fan, conversation from zero. */
  reset(): Promise<PlaygroundState>;
  /** His message; her answer comes back as `pending`. */
  send(text: string, media: readonly PlaygroundMedia[]): Promise<PlaygroundState>;
  /** The state after it; a correction a hard guard keeps out of her bank says which guard (ADR 0102 § 4). */
  rate(verdict: Verdict, destination?: Destination): Promise<RatedState>;
  /** Back to just before his n-th message (from 1), sent again: a new answer to the same moment. */
  branch(fanMessageNumber: number): Promise<PlaygroundState>;
  /** The owner's mark on his desire score after his n-th message (ADR 0103 § 6): kept, with what was counted. */
  markDesire(fanMessageNumber: number, verdict: DesireMarkVerdict): Promise<PlaygroundState>;
  /**
   * Her marks, newest first, each counted again with the weights in force: where the counting goes wrong. `null` is the
   * invented persona, which keeps none (the demo answers with the marks on screen).
   */
  desireMarks(creatorId: CreatorId | null): Promise<DesireMarks>;
  /** The pending answer written again by another voice model, side by side. */
  compare(voiceModel: string): Promise<PlaygroundComparison>;
  advance(hours: number): Promise<PlaygroundState>;
  setNotes(notes: readonly string[]): Promise<PlaygroundState>;
  setSpent(cents: number): Promise<PlaygroundState>;
  sendCreatorMedia(media: CreatorMedia): Promise<PlaygroundState>;
  /** Her bank for the version played (ADR 0102 § 5): what her voice reads, here and with her real fans. */
  bank(creatorId: CreatorId, versionId: PersonaVersionId): Promise<VoiceBank>;
  /** Out of her bank everywhere, kept for history; her bank as it is now. */
  withdrawExample(creatorId: CreatorId, versionId: PersonaVersionId, id: string): Promise<VoiceBank>;
}

export type RatedState = PlaygroundState & {
  readonly exampleBlockedBy?: readonly PlaygroundGuardViolation[];
};

/** The voice the comparison asks for: the fallback of the voice role (ADR 0017), to see if it holds up. */
export const COMPARE_MODEL = 'mistral-large-4';

export type PlaygroundErrorCode =
  'llm_unavailable' | 'unreachable' | 'not_deployed' | 'still_writing' | 'forbidden' | 'failed';

/** What went wrong, said plainly on screen. `message` is the server's own French sentence, when it gave one. */
export class PlaygroundError extends Error {
  constructor(
    readonly code: PlaygroundErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'PlaygroundError';
  }
}

const BASE = '/v1/playground';

async function errorOf(response: Response): Promise<PlaygroundError> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => undefined));
  const code = parsed.success ? parsed.data.error.code : undefined;
  // A 404 from the router itself means the routes are not mounted on this server yet.
  if (response.status === 404 && (code === undefined || code === 'route_not_found')) {
    return new PlaygroundError('not_deployed');
  }
  // The server keeps the playground to the owner: a refusal, not an outage.
  if (response.status === 403) return new PlaygroundError('forbidden');
  // Only the server's own word blames the AI provider (key refused, no credit, rate limit). A 502/503/504 without it is
  // Impera's API not answering, behind its proxy (recette visuelle V-ETA-06).
  if (code === 'llm_unavailable') return new PlaygroundError('llm_unavailable');
  if (response.status === 502 || response.status === 503 || response.status === 504)
    return new PlaygroundError('unreachable');
  if (code === 'answer_in_progress_conflict') return new PlaygroundError('still_writing');
  return new PlaygroundError('failed', parsed.success ? parsed.data.error.message : undefined);
}

async function call<S extends z.ZodType>(
  schema: S,
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'GET',
  body?: unknown,
): Promise<z.infer<S>> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    ...(body !== undefined && {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }).catch(() => {
    // No answer at all (network down, server stopped): the server, not the AI provider.
    throw new PlaygroundError('unreachable');
  });
  if (!response.ok) throw await errorOf(response);
  return schema.parse(await response.json());
}

export function createHttpClient(): PlaygroundClient {
  const state = (): Promise<PlaygroundState> => call(PlaygroundStateSchema, '');
  return {
    isDemo: false,
    state,
    choosePreset: (presetId) => call(PlaygroundStateSchema, '/preset', 'POST', { presetId }),
    choosePersona: (body) => call(PlaygroundStateSchema, '/persona', 'POST', body),
    reset: () => call(PlaygroundStateSchema, '/reset', 'POST'),
    send: async (text, media) => {
      await call(PlaygroundAnswerSchema, '/messages', 'POST', {
        text,
        ...(media.length > 0 && { media }),
      });
      return state();
    },
    rate: async (verdict, destination) => {
      const result = await call(PlaygroundRatingResultSchema, '/rating', 'POST', {
        verdict,
        ...(destination !== undefined && { destination }),
      });
      const next = await state();
      return result.exampleBlockedBy === undefined
        ? next
        : { ...next, exampleBlockedBy: result.exampleBlockedBy };
    },
    branch: (fanMessageNumber) => call(PlaygroundStateSchema, '/branch', 'POST', { fanMessageNumber }),
    markDesire: (fanMessageNumber, verdict) =>
      call(PlaygroundStateSchema, '/desire-marks', 'POST', { fanMessageNumber, verdict }),
    desireMarks: (creatorId) =>
      creatorId === null
        ? Promise.resolve({ weightsNow: '', marks: [] })
        : call(DesireMarksSchema, `/desire-marks?creatorId=${encodeURIComponent(creatorId)}`),
    compare: (voiceModel) => call(PlaygroundComparisonSchema, '/compare', 'POST', { voiceModel }),
    advance: (hours) => call(PlaygroundStateSchema, '/advance', 'POST', { hours }),
    setNotes: (notes) => call(PlaygroundStateSchema, '/notes', 'PUT', { notes }),
    setSpent: (spentCents) => call(PlaygroundStateSchema, '/situation', 'PATCH', { spentCents }),
    sendCreatorMedia: (media) => call(PlaygroundStateSchema, '/creator-media', 'POST', media),
    bank: (creatorId, versionId) =>
      call(
        VoiceBankSchema,
        `/bank?creatorId=${encodeURIComponent(creatorId)}&versionId=${encodeURIComponent(versionId)}`,
      ),
    withdrawExample: (creatorId, versionId, id) =>
      call(VoiceBankSchema, '/bank/withdraw', 'POST', { creatorId, versionId, id }),
  };
}
