import type { NotificationOutcome, NotificationRequest } from '@impera/contracts';

import { creatorNoticeKey, creatorNoticeKind, creatorNoticeMessage } from '../domain/creator-notices';
import type { CreatorNoticeSource } from '../domain/ports';

export interface CreatorNoticesDeps {
  readonly notices: CreatorNoticeSource;
  readonly notify: (request: NotificationRequest, at: Date) => Promise<NotificationOutcome>;
}

/**
 * How far back each run looks: the job runs every five minutes, so a run missed or a worker restarted loses nothing,
 * and what is seen twice rings once (one notification per account, reason and object).
 */
export const CREATOR_NOTICES_LOOKBACK_MS = 30 * 60_000;

/**
 * `notifications.creator_notices` (trou 9 du 21/11): each thing the agency asked of a creator in the last half hour is
 * told to each of her accounts, once, held in her quiet hours and within her daily cap like a question of hers
 * (`decision`), on the sort she may turn off (ADR 0150 § 16 ter). Returns what became of each notification.
 */
export async function notifyCreatorNotices(
  deps: CreatorNoticesDeps,
  at: Date,
): Promise<readonly NotificationOutcome[]> {
  const notices = await deps.notices.between(new Date(at.getTime() - CREATOR_NOTICES_LOOKBACK_MS), at);
  const outcomes: NotificationOutcome[] = [];
  for (const notice of notices) {
    const message = creatorNoticeMessage(notice.subject);
    for (const userId of notice.accounts)
      outcomes.push(
        await deps.notify(
          {
            userId,
            reason: 'decision',
            objectKey: creatorNoticeKey(notice.subject),
            timeZone: notice.timeZone,
            message,
            kind: creatorNoticeKind(notice.subject),
          },
          at,
        ),
      );
  }
  return outcomes;
}
