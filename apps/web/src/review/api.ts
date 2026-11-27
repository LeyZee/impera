import {
  MyShiftReviewSchema,
  type ContestRemarkBody,
  type CreatorId,
  type MyShiftReview,
  type ShiftId,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/** « Mon bilan » as the screens read it (ADR 0170 §§ 12, 26 to 30): `/v1/team/review/…`, parsed with the contract. */
export const REVIEW_KEY = ['team', 'review'] as const;

const JSON_HEADERS = { 'content-type': 'application/json' };

async function send(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${url}: ${String(response.status)}`);
}

/** His review of one shift; nothing asked without a shift. */
export function useMyShiftReview(
  shift: { creatorId: CreatorId; id: ShiftId } | null,
): UseQueryResult<MyShiftReview> {
  return useQuery({
    queryKey: [...REVIEW_KEY, shift?.id ?? null],
    enabled: shift !== null,
    queryFn: async () => {
      if (shift === null) throw new Error('no shift');
      const url = `/v1/team/review/shifts/${shift.id}?creatorId=${shift.creatorId}`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`GET ${url}: ${String(response.status)}`);
      return MyShiftReviewSchema.parse(await response.json());
    },
  });
}

/** He has read it: each fault shown counts as explained from now on (§ 29). */
export const markReviewSeen = (creatorId: CreatorId, shiftId: ShiftId): Promise<void> =>
  send(`/v1/team/review/shifts/${shiftId}/seen`, { creatorId });

/** His contest of one remark, in one line (§ 14). */
export const contestRemark = (remarkId: string, body: ContestRemarkBody): Promise<void> =>
  send(`/v1/team/review/remarks/${remarkId}/contest`, body);
