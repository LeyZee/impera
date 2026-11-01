import { KYC_SLOT_LABELS, type KycSlot } from '@nirvana/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { JSX } from 'react';

import { FanKycRefused, fetchFanKyc } from './api';

/** A fact the agent learns comes with one of his messages: read again now and then, like the reader. */
const REFRESH_MS = 30_000;

/** A server that does not answer is asked again, three times; one that refuses (403, 404) is not. */
export const retryKyc = (failures: number, error: unknown): boolean =>
  !(error instanceof FanKycRefused) && failures < 3;

/** Read again every 30 s, unless the server refused: then never, until the reader opens him again. */
export const kycRefreshMs = (error: unknown): number | false =>
  error instanceof FanKycRefused ? false : REFRESH_MS;

/** « Localisation, Métier »: the canvas lines left, in her persona's order, word for word. */
export const toLearnLine = (slots: readonly KycSlot[]): string =>
  slots.map((slot) => KYC_SLOT_LABELS[slot]).join(', ');

/**
 * The canvas lines left, one read shared by the fan's sheet and its summary line. Never read for a creator (ADR 0023):
 * `enabled` is false for her, and the server would answer her 403.
 */
export function useFanKyc(
  creatorId: string,
  fanId: string,
  enabled: boolean,
): UseQueryResult<KycSlot[], unknown> {
  return useQuery({
    queryKey: ['fan-kyc', creatorId, fanId],
    queryFn: () => fetchFanKyc(creatorId, fanId),
    enabled,
    retry: retryKyc,
    refetchInterval: (q) => kycRefreshMs(q.state.error),
  });
}

/**
 * What she has still to learn about him (P5-01), among the canvas lines her persona collects: one quiet line next to
 * his limits. Nothing once every line is learnt, and nothing while it loads or when the server does not answer: the
 * reader already says so, and this line never stops the agent.
 */
export function FanToLearn({ creatorId, fanId }: { creatorId: string; fanId: string }): JSX.Element | null {
  const slots = useFanKyc(creatorId, fanId, true).data;
  if (slots === undefined || slots.length === 0) return null;
  return (
    <p className="tr-learn">
      <span className="tr-learn__title">À apprendre</span>
      <span className="tr-learn__slots">{toLearnLine(slots)}</span>
    </p>
  );
}
