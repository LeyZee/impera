import { describe, expect, it } from 'vitest';

import { AgeDisputeForbidden, AgeDisputeReasonInvalid } from '../errors';
import {
  mayConfirmDisputedAge,
  requestedChange,
  withAgeDisputed,
  withDeclaredAge,
  withFlag,
  withFlagIfUnset,
  withHumanConfirmation,
  withoutFlag,
} from '../flags';

const frozen = { reason: 'money_trouble', since: '2026-10-02T10:00:00Z' } as const;

describe('withFlag', () => {
  it('adds a limit and keeps the others', () => {
    expect(withFlag({ fragile: true }, { flag: 'salesFrozen', value: frozen })).toEqual({
      fragile: true,
      salesFrozen: frozen,
    });
  });

  it('changes nothing when the limit already has this value', () => {
    expect(withFlag({ salesFrozen: frozen }, { flag: 'salesFrozen', value: { ...frozen } })).toBeNull();
    expect(withFlag({ spendingLimitMinor: 5000 }, { flag: 'spendingLimitMinor', value: 3000 })).toEqual({
      spendingLimitMinor: 3000,
    });
  });

  it('keeps the first confirmation date, and the start of a freeze for the same reason', () => {
    const confirmed = { ageConfirmedAt: '2026-10-01T09:00:00Z' };
    expect(withFlag(confirmed, { flag: 'ageConfirmedAt', value: '2026-10-20T09:00:00Z' })).toBeNull();
    const later = { reason: 'money_trouble', since: '2026-10-20T09:00:00Z' } as const;
    expect(withFlag({ salesFrozen: frozen }, { flag: 'salesFrozen', value: later })).toBeNull();
    const other = { reason: 'distress', since: '2026-10-20T09:00:00Z' } as const;
    expect(withFlag({ salesFrozen: frozen }, { flag: 'salesFrozen', value: other })).toEqual({
      salesFrozen: other,
    });
  });
});

describe('requestedChange', () => {
  const now = new Date('2026-10-23T12:00:00Z');

  it('dates a confirmation and a freeze with the server clock', () => {
    expect(requestedChange({ flag: 'ageConfirmedAt', set: true }, now)).toEqual({
      flag: 'ageConfirmedAt',
      value: '2026-10-23T12:00:00.000Z',
    });
    expect(requestedChange({ flag: 'salesFrozen', set: true, freezeReason: 'operator' }, now)).toEqual({
      flag: 'salesFrozen',
      value: { reason: 'operator', since: '2026-10-23T12:00:00.000Z' },
    });
  });

  it('takes the ceiling as asked and turns the switches on', () => {
    expect(requestedChange({ flag: 'spendingLimitMinor', set: true, limitMinor: 2500 }, now)).toEqual({
      flag: 'spendingLimitMinor',
      value: 2500,
    });
    expect(requestedChange({ flag: 'doNotContact', set: true }, now)).toEqual({
      flag: 'doNotContact',
      value: true,
    });
  });
});

describe('withoutFlag', () => {
  it('lifts one limit, or changes nothing when it was not set', () => {
    expect(withoutFlag({ fragile: true, noExplicit: true }, 'fragile')).toEqual({ noExplicit: true });
    expect(withoutFlag({ noExplicit: true }, 'fragile')).toBeNull();
  });

  it('never lifts a disputed age alone: only a confirmation by the owner or a manager ends it (SUIVI-04)', () => {
    const ageDisputed = { since: '2026-10-22T10:00:00.000Z', by: 'policy' } as const;
    expect(() => withoutFlag({ ageDisputed }, 'ageDisputed')).toThrow(AgeDisputeForbidden);
    expect(() => withoutFlag({}, 'ageDisputed')).toThrow(AgeDisputeForbidden);
  });
});

describe('withFlagIfUnset', () => {
  const money = { reason: 'money_trouble', since: '2026-10-17T20:00:00.000Z' } as const;

  it('sets a limit nobody set yet', () => {
    expect(withFlagIfUnset({}, { flag: 'salesFrozen', value: money })).toEqual({ salesFrozen: money });
  });

  it('keeps a freeze a human set, whatever its reason', () => {
    const operator = { salesFrozen: { reason: 'operator', since: '2026-10-10T09:00:00.000Z' } } as const;
    expect(withFlagIfUnset(operator, { flag: 'salesFrozen', value: money })).toBeNull();
  });
});

describe('his age taken back, and confirmed again', () => {
  const NOW = new Date('2026-10-17T20:00:00.000Z');
  const confirmed = { ageConfirmedAt: '2026-10-01T09:00:00.000Z', fragile: true } as const;

  it('takes back a confirmation and disputes it, even when nothing was confirmed yet', () => {
    expect(withAgeDisputed(confirmed, 'policy', NOW)).toEqual({
      fragile: true,
      ageDisputed: { since: NOW.toISOString(), by: 'policy' },
    });
    expect(withAgeDisputed({}, 'human', NOW)).toEqual({
      ageDisputed: { since: NOW.toISOString(), by: 'human' },
    });
    expect(
      withAgeDisputed({ ageDisputed: { since: '2026-10-02T09:00:00.000Z', by: 'human' } }, 'policy', NOW),
    ).toBeNull();
  });

  it('confirms his own statement only where nothing was confirmed and nothing taken back', () => {
    expect(withDeclaredAge({}, NOW)).toEqual({ ageConfirmedAt: NOW.toISOString() });
    expect(withDeclaredAge(confirmed, NOW)).toBeNull();
    expect(withDeclaredAge({ ageDisputed: { since: NOW.toISOString(), by: 'policy' } }, NOW)).toBeNull();
  });

  const change = { flag: 'ageConfirmedAt', value: NOW.toISOString() } as const;
  const disputed = { ageDisputed: { since: NOW.toISOString(), by: 'policy' } } as const;
  const reason = 'Pièce d’identité vue en appel vidéo';

  it('lets the owner or an active manager confirm a disputed age with a reason, which settles the dispute', () => {
    for (const scope of ['owner', 'agency'] as const) {
      expect(withHumanConfirmation(disputed, change, { scope, reason })).toEqual({
        ageConfirmedAt: NOW.toISOString(),
      });
    }
    // An undisputed age stays a chatter's call, with or without a reason.
    expect(withHumanConfirmation({}, change, { scope: 'self' })).toEqual({
      ageConfirmedAt: NOW.toISOString(),
    });
  });

  it('refuses a disputed age to a chatter or an unknown account, and to anyone without a written reason', () => {
    for (const scope of ['self', null] as const) {
      expect(() => withHumanConfirmation(disputed, change, { scope, reason })).toThrow(AgeDisputeForbidden);
    }
    expect(() => withHumanConfirmation(disputed, change, { scope: 'owner' })).toThrow(
      AgeDisputeReasonInvalid,
    );
    expect(() => withHumanConfirmation(disputed, change, { scope: 'agency', reason: '  ' })).toThrow(
      AgeDisputeReasonInvalid,
    );
  });

  it('says who may lift a dispute', () => {
    expect(mayConfirmDisputedAge('owner')).toBe(true);
    expect(mayConfirmDisputedAge('agency')).toBe(true);
    expect(mayConfirmDisputedAge('self')).toBe(false);
    expect(mayConfirmDisputedAge(null)).toBe(false);
  });
});
