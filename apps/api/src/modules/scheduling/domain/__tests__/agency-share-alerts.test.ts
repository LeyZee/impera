import {
  CreatorIdSchema,
  PayPeriodSchema,
  PlatformAccountIdSchema,
  PUSH_BODY_MAX,
  PushMessageSchema,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { agencyShareAlertMessage, fortnightText, type AgencyShareEvent } from '../agency-share-alerts';

// Everything below is invented (ADR 0010): the creator, her account and the shares, never the agency's own.
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const ACCOUNT = PlatformAccountIdSchema.parse('0192f3a0-0000-7000-8000-0000000000b1');
const common = {
  creatorId: CREATOR,
  platform: 'reveal' as const,
  platformAccountId: ACCOUNT,
  from: PayPeriodSchema.parse('2026-10-16'),
  to: '2026-10-31',
  currency: 'EUR' as const,
};
const mismatch: AgencyShareEvent = {
  type: 'agency_share_mismatch',
  payload: {
    ...common,
    sales: 2,
    refunds: 0,
    creatorMinor: 1000,
    expectedCreatorMinor: 1040,
    differenceMinor: -40,
  },
};
const changed: AgencyShareEvent = {
  type: 'agency_share_changed',
  payload: { ...common, previousAgencyBps: 3333, agencyBps: 3750 },
};

describe('the owner told of an alert on the agency’s share (PAY-04)', () => {
  it('says a fortnight as the sheet does', () => {
    expect(fortnightText(PayPeriodSchema.parse('2026-11-01'))).toBe('du 1er au 15 novembre');
    expect(fortnightText(PayPeriodSchema.parse('2026-10-16'))).toBe('du 16 au 31 octobre');
    expect(fortnightText(PayPeriodSchema.parse('2026-02-16'))).toBe('du 16 au 28 février');
  });

  it('names her, the platform and the fortnight, and opens her sheet', () => {
    expect(agencyShareAlertMessage(mismatch, 'Nora')).toEqual({
      title: 'Part de l’agence à vérifier',
      body: 'Nora, chez Reveal, quinzaine du 16 au 31 octobre : sa part s’écarte du pourcentage réglé pour elle.',
      url: `/creatrices?onglet=pourcentage&creatrice=${CREATOR}`,
    });
    expect(agencyShareAlertMessage(changed, 'Nora').body).toBe(
      'Nora, chez Reveal, quinzaine du 16 au 31 octobre : la part de l’agence a changé par rapport à la quinzaine d’avant.',
    );
  });

  it('shows no amount nor share on a locked screen, and fits a push with a long name', () => {
    for (const alert of [mismatch, changed]) {
      const message = agencyShareAlertMessage(alert, 'N'.repeat(200));
      expect(PushMessageSchema.parse(message)).toEqual(message);
      expect(message.body?.length).toBeLessThanOrEqual(PUSH_BODY_MAX);
      expect(JSON.stringify(message)).not.toMatch(/€|%|\d{2},\d/u);
    }
  });
});
