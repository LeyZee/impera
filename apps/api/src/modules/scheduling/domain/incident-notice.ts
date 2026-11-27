import { PUSH_BODY_MAX, type NotificationRequest, type ShiftFeedbackId } from '@impera/contracts';

import { clockIn } from './report-reminders';

/** What the notice of an incident says, read on the service connection: never the incident's own words. */
export interface IncidentFacts {
  readonly feedbackId: ShiftFeedbackId;
  /** The account that wrote it: never told of their own incident. */
  readonly authorUserId: string;
  readonly memberName: string;
  readonly creatorName: string;
  readonly shiftStartsAt: Date;
  readonly shiftEndsAt: Date;
}

/** Who is told: the owners and the active managers of the creator, each in their own zone. */
export interface IncidentRecipient {
  readonly userId: string;
  readonly timeZone: string;
}

/** Where a touch opens: Équipe › Rapports, the incidents first. */
const REPORTS_PATH = '/equipe/rapports';

/**
 * The push of an incident of the mini feedback (trous béants n° 1, 21/11), pure: to the owner and each active manager
 * of the creator, once per account and feedback (`notify` keeps it), at once. It names who and where, never what: the
 * incident's text stays in the app, behind a sign-in.
 */
export function incidentNotices(
  facts: IncidentFacts,
  recipients: readonly IncidentRecipient[],
): NotificationRequest[] {
  return recipients
    .filter((one) => one.userId !== facts.authorUserId)
    .map((one) => ({
      userId: one.userId,
      reason: 'team',
      objectKey: `shift-incident:${facts.feedbackId}`,
      timeZone: one.timeZone,
      message: {
        title: 'Incident signalé',
        body: `${facts.memberName} signale un incident sur ${facts.creatorName}, shift de ${clockIn(facts.shiftStartsAt, one.timeZone)} – ${clockIn(facts.shiftEndsAt, one.timeZone)}.`.slice(
          0,
          PUSH_BODY_MAX,
        ),
        url: REPORTS_PATH,
        tag: `shift-incident:${facts.feedbackId}`,
      },
    }));
}
