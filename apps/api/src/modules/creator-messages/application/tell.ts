import type { NotificationOutcome, NotificationRequest, ToAgencyMessage } from '@impera/contracts';

import { answerKey, answerNotice, toAgencyKey, toAgencyNotice } from '../domain/notice';
import type { MessagePhones } from '../domain/ports';

export interface TellDeps {
  readonly phones: MessagePhones;
  /** The `notifications` module's `notify`: once per account and message, under each one's quiet hours. */
  readonly notify: (request: NotificationRequest, at: Date) => Promise<NotificationOutcome>;
}

/** Her message, to her owners and her managers (recette 27/11, G13): one notification each, a replay rings nothing. */
export async function tellAgency(deps: TellDeps, message: ToAgencyMessage, now: Date): Promise<number> {
  const { creatorName, phones } = await deps.phones.agency(message.creatorId);
  const notice = toAgencyNotice(creatorName, message.kind);
  for (const phone of phones)
    await deps.notify({ ...phone, reason: 'team', objectKey: toAgencyKey(message.id), message: notice }, now);
  return phones.length;
}

/** The owner's answer, to her own accounts (recette 27/11, G4). */
export async function tellHer(deps: TellDeps, message: ToAgencyMessage, now: Date): Promise<number> {
  if (message.answer === null) return 0;
  const phones = await deps.phones.hers(message.creatorId);
  const notice = answerNotice();
  for (const phone of phones)
    await deps.notify({ ...phone, reason: 'team', objectKey: answerKey(message.id), message: notice }, now);
  return phones.length;
}
