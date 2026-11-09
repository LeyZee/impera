import { describe, expect, it } from 'vitest';

import {
  distressMood,
  fragileProposal,
  fragileWhy,
  strongAttachment,
  type FragileCandidate,
} from '../fragile';

const now = new Date('2026-11-08T20:00:00Z');
const daysAgo = (days: number): Date => new Date(now.getTime() - days * 86_400_000);

const fan = (over: Partial<FragileCandidate> = {}): FragileCandidate => ({
  attachment: { value: 'jaloux, « tu me manques »', at: daysAgo(3) },
  moods: null,
  distressAt: null,
  spentRecentMinor: 0,
  lastSpentAt: null,
  spentBaselineMinor: 0,
  dismissedAt: null,
  ...over,
});

describe('the AI proposing to mark a fan « fragile » (ADR 0085 § 9, lot b2)', () => {
  it('reads a strong attachment in the words of his card, accents and case aside', () => {
    expect(strongAttachment('Très attaché')).toBe(true);
    expect(strongAttachment('POSSESSIF')).toBe(true);
    expect(strongAttachment('il lui dit je t’aime')).toBe(true);
    expect(strongAttachment('détaché')).toBe(false);
    expect(strongAttachment('curieux')).toBe(false);
  });

  it('reads distress in his moods, never a word that only starts like one', () => {
    expect(distressMood('seul le soir · stressé')).toBe(true);
    expect(distressMood('Déprimé')).toBe(true);
    expect(distressMood('angoissée')).toBe(true);
    expect(distressMood('seulement joueur')).toBe(false);
    expect(distressMood('excité')).toBe(false);
  });

  it('proposes nothing without a strong attachment, whatever else', () => {
    expect(
      fragileProposal(fan({ attachment: { value: 'détaché', at: daysAgo(1) }, distressAt: daysAgo(1) }), now),
    ).toBeNull();
  });

  it('proposes nothing on a strong attachment alone', () => {
    expect(fragileProposal(fan(), now)).toBeNull();
  });

  it('proposes on a handoff for distress within 30 days, since that handoff', () => {
    expect(fragileProposal(fan({ distressAt: daysAgo(2) }), now)).toEqual({
      signs: ['distress'],
      since: daysAgo(2),
    });
    expect(fragileProposal(fan({ distressAt: daysAgo(31) }), now)).toBeNull();
  });

  it('proposes on a mood of distress on his card', () => {
    expect(fragileProposal(fan({ moods: { value: 'triste', at: daysAgo(4) } }), now)).toEqual({
      signs: ['distress'],
      since: daysAgo(4),
    });
  });

  it('proposes on his spending climbing fast: twice his weekly average and 50 € at least', () => {
    const climbing = fan({ spentRecentMinor: 8_000, lastSpentAt: daysAgo(1), spentBaselineMinor: 8 * 4_000 });
    expect(fragileProposal(climbing, now)).toEqual({ signs: ['spending'], since: daysAgo(1) });
    expect(fragileProposal(fan({ spentRecentMinor: 7_999, spentBaselineMinor: 8 * 4_000 }), now)).toBeNull();
    expect(fragileProposal(fan({ spentRecentMinor: 4_999, spentBaselineMinor: 0 }), now)).toBeNull();
  });

  it('keeps a proposal set aside away for 30 days, unless a new sign of distress comes', () => {
    const dismissed = fan({ distressAt: daysAgo(5), dismissedAt: daysAgo(3) });
    expect(fragileProposal(dismissed, now)).toBeNull();
    expect(fragileProposal({ ...dismissed, distressAt: daysAgo(1) }, now)?.signs).toEqual(['distress']);
    const spending = fan({ spentRecentMinor: 10_000, dismissedAt: daysAgo(10) });
    expect(fragileProposal(spending, now)).toBeNull();
    expect(fragileProposal({ ...spending, dismissedAt: daysAgo(30) }, now)?.signs).toEqual(['spending']);
  });

  it('says which signs, never a value of his card', () => {
    expect(fragileWhy(['distress'])).toBe(
      'Il est très attaché et semble en détresse. L’IA propose de le marquer fragile : à toi d’accepter ou d’écarter.',
    );
    expect(fragileWhy(['distress', 'spending'])).toContain('dépense de plus en plus vite');
  });
});
