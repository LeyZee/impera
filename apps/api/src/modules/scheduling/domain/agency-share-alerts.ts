import {
  PLATFORM_NAMES,
  PUSH_BODY_MAX,
  payPeriodLastDay,
  type CreatorId,
  type EventPayload,
  type PayPeriod,
  type PushMessage,
} from '@impera/contracts';

/**
 * The owner told of an alert on the agency's share (ADR 0054 §§ 2 and 5, PAY-04 of the recette of 16/11), pure: the
 * push message of one `agency_share_mismatch` or `agency_share_changed`. As on Telegram, no amount and no share: a
 * notification shows on a locked screen. The sheet « Part de l'agence » says the figures.
 */
export type AgencyShareEvent =
  | { readonly type: 'agency_share_mismatch'; readonly payload: EventPayload<'agency_share_mismatch'> }
  | { readonly type: 'agency_share_changed'; readonly payload: EventPayload<'agency_share_changed'> };

/** « du 1er au 15 novembre », « du 16 au 31 octobre »: a fortnight as the sheet says it. */
export function fortnightText(from: PayPeriod): string {
  const last = payPeriodLastDay(from);
  const month = new Date(`${last}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', month: 'long' });
  return `du ${from.endsWith('-01') ? '1er' : '16'} au ${String(Number(last.slice(8)))} ${month}`;
}

/** Where a touch lands: her sheet « Part de l'agence ». */
const agencySharePath = (creatorId: CreatorId): string =>
  `/creatrices?onglet=pourcentage&creatrice=${creatorId}`;

const NAME_MAX = 60;

export function agencyShareAlertMessage(alert: AgencyShareEvent, creatorName: string): PushMessage {
  const name = creatorName.length > NAME_MAX ? `${creatorName.slice(0, NAME_MAX - 1)}…` : creatorName;
  const where = `${name}, chez ${PLATFORM_NAMES[alert.payload.platform]}, quinzaine ${fortnightText(alert.payload.from)}`;
  const body =
    alert.type === 'agency_share_mismatch'
      ? `${where} : sa part s’écarte du pourcentage réglé pour elle.`
      : `${where} : la part de l’agence a changé par rapport à la quinzaine d’avant.`;
  return {
    title: 'Part de l’agence à vérifier',
    body: body.slice(0, PUSH_BODY_MAX),
    url: agencySharePath(alert.payload.creatorId),
  };
}
