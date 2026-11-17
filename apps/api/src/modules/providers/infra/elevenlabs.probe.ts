import { z } from 'zod';

import type { ProbeResult, ProviderProbe } from '../domain/probe';

import type { FetchLike } from './http';

/**
 * The cheapest voice model: half a character of the month per character. « ok » costs one or two (ADR 0091 § 7).
 * The audio is read and dropped, never kept.
 */
const PROBE_MODEL = 'eleven_flash_v2_5';
const PROBE_MODEL_LABEL = 'Flash v2.5';
const PROBE_TEXT = 'ok';
const PROBE_TIMEOUT_MS = 20_000;

/** `{"detail":{"status":"quota_exceeded","message":"…"}}` */
const RefusalSchema = z.object({ detail: z.object({ status: z.string() }) });

function statusOf(text: string): string | null {
  try {
    const parsed = RefusalSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.detail.status : null;
  } catch {
    return null;
  }
}

export interface ElevenLabsProbeOptions {
  readonly fetch: FetchLike;
  readonly baseUrl?: string;
  readonly now?: () => number;
}

/** One tiny speech (« ok ») with the chosen voice: the only proof the month still has characters to speak with. */
export function createElevenLabsProbe(options: ElevenLabsProbeOptions): ProviderProbe {
  const baseUrl = options.baseUrl ?? 'https://api.elevenlabs.io';
  const now = options.now ?? Date.now;
  return {
    provider: 'elevenlabs',
    async probe(key, voiceId): Promise<ProbeResult> {
      if (voiceId === null) return { outcome: 'no_voice', latencyMs: null, model: null };
      const startedAt = now();
      const tried = (outcome: ProbeResult['outcome']): ProbeResult => ({
        outcome,
        latencyMs: Math.max(0, Math.round(now() - startedAt)),
        model: PROBE_MODEL_LABEL,
      });
      try {
        const response = await options.fetch(
          `${baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_22050_32`,
          {
            method: 'POST',
            headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
            body: JSON.stringify({ text: PROBE_TEXT, model_id: PROBE_MODEL }),
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          },
        );
        const body = await response.text();
        const { status } = response;
        if (status === 200) return tried('answers');
        const detail = statusOf(body);
        if (status === 402 || detail === 'quota_exceeded' || detail === 'payment_required')
          return tried('no_credit');
        if (status === 401 || status === 403) return tried('key_refused');
        if (detail === 'voice_not_found') return tried('no_voice');
        if (status === 429) return tried('rate_limited');
        return tried('not_answering');
      } catch (error) {
        return tried(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'not_answering');
      }
    },
  };
}
