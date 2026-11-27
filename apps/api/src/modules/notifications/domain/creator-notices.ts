import type { NotificationKind, PushMessage } from '@impera/contracts';

/**
 * What the agency asked of a creator, told on her phone (trou 9 du 21/11, ADR 0150 § 16 ter), pure. Four things ring:
 * a request for content (the agency's, the stock's or a trend idea's), a script the cadence asks, a proposition of the
 * agency for her agenda, and her week validated by the owner, ready for her to accept. Each one is told once per
 * account (its object key), on the sort she may turn off. The lock screen says what to do and by when, never what the
 * request says: its words stay in the app.
 */
export type CreatorNoticeSubject =
  | {
      readonly kind: 'content_request';
      readonly requestId: string;
      readonly script: boolean;
      /** Her calendar day to deposit it by (`YYYY-MM-DD`). */
      readonly dueOn: string;
    }
  | { readonly kind: 'proposition'; readonly suggestionId: string }
  | {
      readonly kind: 'week';
      /** Her Monday (`YYYY-MM-DD`). */
      readonly week: string;
    };

export interface CreatorNotice {
  readonly subject: CreatorNoticeSubject;
  /** Her creator's zone: her quiet hours and her day. */
  readonly timeZone: string;
  /** Her own accounts (role `creator`, linked to her creator alone); none yet is fine. */
  readonly accounts: readonly string[];
}

/** Her Contenu screen (requests and drops), her agenda, her agenda on the week view. */
const CONTENT_SCREEN = '/contenu';
const AGENDA_SCREEN = '/agenda';
const WEEK_SCREEN = '/agenda?vue=semaine';

/** A calendar day as she reads it: « jeudi 3 décembre ». The day is hers already, so it is formatted as is. */
const DAY = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const dayText = (day: string): string => DAY.format(new Date(`${day}T12:00:00.000Z`));

/** The sort she may turn off: the week has its own, every other ask is an agency request. */
export function creatorNoticeKind(subject: CreatorNoticeSubject): NotificationKind {
  return subject.kind === 'week' ? 'week_to_validate' : 'agency_request';
}

/** Once per account and thing asked: a replayed job, or the next run seeing it again, rings nothing twice. */
export function creatorNoticeKey(subject: CreatorNoticeSubject): string {
  switch (subject.kind) {
    case 'content_request':
      return `content_request:${subject.requestId}`;
    case 'proposition':
      return `proposition:${subject.suggestionId}`;
    case 'week':
      return `week:${subject.week}`;
  }
}

export function creatorNoticeMessage(subject: CreatorNoticeSubject): PushMessage {
  switch (subject.kind) {
    case 'content_request':
      return subject.script
        ? {
            title: 'Un script t’est demandé',
            body: `À tourner et déposer pour ${dayText(subject.dueOn)}.`,
            url: CONTENT_SCREEN,
          }
        : {
            title: 'Nouvelle demande de l’agence',
            body: `À déposer pour ${dayText(subject.dueOn)}.`,
            url: CONTENT_SCREEN,
          };
    case 'proposition':
      return {
        title: 'Nouvelle proposition pour ton agenda',
        body: 'Ouvre ton agenda pour l’accepter ou la refuser.',
        url: AGENDA_SCREEN,
      };
    case 'week':
      return {
        title: 'Ta semaine est prête',
        body: `La semaine du ${dayText(subject.week)} t’attend : ouvre-la pour l’accepter.`,
        url: WEEK_SCREEN,
      };
  }
}
