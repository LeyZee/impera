import {
  ApiErrorSchema,
  PlaygroundAnswerSchema,
  PlaygroundComparisonSchema,
  PlaygroundRatingResultSchema,
  PlaygroundStateSchema,
  type Destination,
  type PlaygroundComparison,
  type PlaygroundMedia,
  type PlaygroundState,
  type Verdict,
} from '@nirvana/contracts';
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
  /** Same fan, conversation from zero. */
  reset(): Promise<PlaygroundState>;
  /** His message; her answer comes back as `pending`. */
  send(text: string, media: readonly PlaygroundMedia[]): Promise<PlaygroundState>;
  rate(verdict: Verdict, destination?: Destination): Promise<PlaygroundState>;
  /** Back to just before his n-th message (from 1), sent again: a new answer to the same moment. */
  branch(fanMessageNumber: number): Promise<PlaygroundState>;
  /** The pending answer written again by another voice model, side by side. */
  compare(voiceModel: string): Promise<PlaygroundComparison>;
  advance(hours: number): Promise<PlaygroundState>;
  setNotes(notes: readonly string[]): Promise<PlaygroundState>;
  setSpent(cents: number): Promise<PlaygroundState>;
  sendCreatorMedia(media: CreatorMedia): Promise<PlaygroundState>;
}

/** The voice the comparison asks for: the fallback of the voice role (ADR 0017), to see if it holds up. */
export const COMPARE_MODEL = 'mistral-large-latest';

export type PlaygroundErrorCode =
  'llm_unavailable' | 'not_deployed' | 'still_writing' | 'forbidden' | 'failed';

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
  if (code === 'llm_unavailable' || response.status === 503) return new PlaygroundError('llm_unavailable');
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
    reset: () => call(PlaygroundStateSchema, '/reset', 'POST'),
    send: async (text, media) => {
      await call(PlaygroundAnswerSchema, '/messages', 'POST', {
        text,
        ...(media.length > 0 && { media }),
      });
      return state();
    },
    rate: async (verdict, destination) => {
      await call(PlaygroundRatingResultSchema, '/rating', 'POST', {
        verdict,
        ...(destination !== undefined && { destination }),
      });
      return state();
    },
    branch: (fanMessageNumber) => call(PlaygroundStateSchema, '/branch', 'POST', { fanMessageNumber }),
    compare: (voiceModel) => call(PlaygroundComparisonSchema, '/compare', 'POST', { voiceModel }),
    advance: (hours) => call(PlaygroundStateSchema, '/advance', 'POST', { hours }),
    setNotes: (notes) => call(PlaygroundStateSchema, '/notes', 'PUT', { notes }),
    setSpent: (spentCents) => call(PlaygroundStateSchema, '/situation', 'PATCH', { spentCents }),
    sendCreatorMedia: (media) => call(PlaygroundStateSchema, '/creator-media', 'POST', media),
  };
}
