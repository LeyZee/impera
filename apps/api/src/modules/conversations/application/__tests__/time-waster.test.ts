import { newId, ScriptRunIdSchema, type TimeWasterSetting } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { StoredScriptRun } from '../../domain/ports';
import { timeWasterWait, type TimeWasterRead } from '../time-waster';

// Invented values: the agency's own are entered in the CRM, never written in the repository.
const SETTING: TimeWasterSetting = {
  minUnenteredScripts: 1,
  provenHours: 24 * 30,
  slowedDelayMinutes: { min: 60, max: 120 },
  dormantDelayMinutes: { min: 600, max: 900 },
  slowedRepliesPerDay: 2,
  dormantRepliesPerDay: 1,
};
const NOW = new Date('2026-11-26T20:05:00Z');
const at = (iso: string) => new Date(iso);

const base: TimeWasterRead = {
  now: NOW,
  timeZone: 'Europe/Paris',
  conversationId: 'conversation-1',
  setting: SETTING,
  flags: { ageConfirmedAt: '2026-11-01T10:00:00Z' },
  careOpen: false,
  firstMessageAt: at('2026-11-20T10:00:00Z'),
  spentMinor: 0,
  lastPurchaseAt: null,
  unboughtRuns: 1,
  stalledRuns: [],
  fanSigns: [],
  history: [
    { author: 'ai', at: at('2026-11-26T18:00:00Z') },
    { author: 'fan', at: at('2026-11-26T20:00:00Z') },
    { author: 'fan', at: at('2026-11-26T20:04:00Z') },
  ],
};

const stalled = (endedAt: Date): StoredScriptRun => ({
  id: newId(ScriptRunIdSchema),
  run: {
    scriptRef: 's',
    status: 'stalled',
    steps: [
      { stepIndex: 0, kind: 'free', outcome: 'opened', priceMinor: null, sentAt: endedAt, at: endedAt },
      { stepIndex: 1, kind: 'paid', outcome: 'sent', priceMinor: 1000, sentAt: endedAt, at: endedAt },
    ],
    ignoredMessages: 0,
    startedAt: endedAt,
    endedAt,
  },
});

describe('timeWasterWait (ADR 0135 § 6)', () => {
  it('makes a time-waster wait from his first message waiting', () => {
    const wait = timeWasterWait(base);
    expect(wait?.level).toBe('slowed');
    const minutes = ((wait?.until?.getTime() ?? 0) - at('2026-11-26T20:00:00Z').getTime()) / 60_000;
    expect(minutes).toBeGreaterThanOrEqual(60);
    expect(minutes).toBeLessThanOrEqual(120);
  });

  it('lets her answer once the wait is over', () => {
    expect(timeWasterWait({ ...base, now: at('2026-11-26T22:01:00Z') })).toEqual({
      level: 'slowed',
      until: null,
    });
  });

  it('never makes anyone wait without her rule, a payer, a new or a protected fan', () => {
    expect(timeWasterWait({ ...base, setting: undefined })).toBeNull();
    expect(timeWasterWait({ ...base, spentMinor: 500 })).toBeNull();
    expect(timeWasterWait({ ...base, unboughtRuns: 0 })).toBeNull();
    expect(timeWasterWait({ ...base, careOpen: true })).toBeNull();
    expect(timeWasterWait({ ...base, flags: { ...base.flags, fragile: true } })).toBeNull();
    expect(timeWasterWait({ ...base, flags: null })).toBeNull();
  });

  it('waits nothing when nothing of his is waiting', () => {
    expect(
      timeWasterWait({
        ...base,
        history: [...base.history, { author: 'ai', at: at('2026-11-26T20:05:00Z') }],
      }),
    ).toEqual({ level: 'slowed', until: null });
  });

  it('moves to her next day once her answers of the day are spent', () => {
    const history = [
      { author: 'ai', at: at('2026-11-26T09:00:00Z') },
      { author: 'fan', at: at('2026-11-26T10:00:00Z') },
      { author: 'ai', at: at('2026-11-26T12:00:00Z') },
      { author: 'fan', at: at('2026-11-26T20:00:00Z') },
    ];
    const wait = timeWasterWait({ ...base, history, now: at('2026-11-26T22:30:00Z') });
    expect(wait?.until?.getTime()).toBeGreaterThanOrEqual(at('2026-11-26T23:00:00Z').getTime());
  });

  it('does not count a script he left in plan alone as enough to answer him rarely', () => {
    const wait = timeWasterWait({
      ...base,
      unboughtRuns: 3,
      stalledRuns: [stalled(at('2026-11-25T20:00:00Z'))],
    });
    expect(wait?.level).toBe('slowed');
  });

  describe('the truly tiresome one (Charles, 27/11)', () => {
    const tripled = { ...base, unboughtRuns: 3 };
    const sign = (s: TimeWasterRead['fanSigns'][number]['sign'], iso: string) => ({ sign: s, at: at(iso) });

    it('answers rarely with three times the scripts refused and two different signs', () => {
      const fanSigns = [sign('haggles', '2026-11-24T10:00:00Z'), sign('pressure', '2026-11-25T10:00:00Z')];
      expect(timeWasterWait({ ...tripled, fanSigns })?.level).toBe('dormant');
      expect(timeWasterWait({ ...base, unboughtRuns: 2, fanSigns })?.level).toBe('slowed');
      expect(timeWasterWait({ ...tripled, fanSigns: fanSigns.slice(0, 1) })?.level).toBe('slowed');
    });

    it('counts a script he left in plan as a sign', () => {
      const fanSigns = [sign('haggles', '2026-11-24T10:00:00Z')];
      const left = [stalled(at('2026-11-25T20:00:00Z'))];
      expect(timeWasterWait({ ...tripled, fanSigns, stalledRuns: left })?.level).toBe('dormant');
    });

    it('counts a contact asked and a promise broken only from the second', () => {
      const once = [
        sign('haggles', '2026-11-20T10:00:00Z'),
        sign('contact_insistence', '2026-11-21T10:00:00Z'),
      ];
      expect(timeWasterWait({ ...tripled, fanSigns: once })?.level).toBe('slowed');
      const twice = [...once, sign('contact_insistence', '2026-11-22T10:00:00Z')];
      expect(timeWasterWait({ ...tripled, fanSigns: twice })?.level).toBe('dormant');
      const promises = [
        sign('haggles', '2026-11-20T10:00:00Z'),
        sign('purchase_promise', '2026-11-22T10:00:00Z'),
        sign('purchase_promise', '2026-11-26T10:00:00Z'),
      ];
      // The second promise is not broken yet: less than 48 h old.
      expect(timeWasterWait({ ...tripled, fanSigns: promises })?.level).toBe('slowed');
      expect(timeWasterWait({ ...tripled, fanSigns: promises, now: at('2026-11-28T12:00:00Z') })?.level).toBe(
        'dormant',
      );
    });

    it('brings him back to slowed when he apologises, and forgets signs older than 14 days', () => {
      const fanSigns = [
        sign('haggles', '2026-11-24T10:00:00Z'),
        sign('pressure', '2026-11-25T10:00:00Z'),
        sign('apologised', '2026-11-26T10:00:00Z'),
      ];
      expect(timeWasterWait({ ...tripled, fanSigns })?.level).toBe('slowed');
      const old = [sign('haggles', '2026-11-01T10:00:00Z'), sign('pressure', '2026-11-25T10:00:00Z')];
      expect(timeWasterWait({ ...tripled, fanSigns: old })?.level).toBe('slowed');
    });
  });
});
