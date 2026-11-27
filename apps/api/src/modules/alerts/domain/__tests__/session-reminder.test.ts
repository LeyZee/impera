import { PlatformAccountIdSchema, PUSH_BODY_MAX, PUSH_TITLE_MAX } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { clockText, sessionRemindersDue, type SessionReminderClock } from '../agency/session-reminder';

/** Paris in November is UTC+1: 18 h there is 17:00Z. Invented accounts of a demo creator. */
const ZONE = 'Europe/Paris';
const SIX_PM = 18 * 60;
const accountId = PlatformAccountIdSchema.parse('018f0000-0000-7000-8000-0000000000b1');

const clock = (over: Partial<SessionReminderClock> = {}): SessionReminderClock => ({
  platformAccountId: accountId,
  platform: 'reveal',
  creatorName: 'Créatrice Démo',
  state: 'valid',
  expiresAt: new Date('2026-11-27T17:05:00Z'),
  ...over,
});

const due = (now: string, clocks: readonly SessionReminderClock[] = [clock()], minute = SIX_PM) =>
  sessionRemindersDue({ clocks, minute, timeZone: ZONE, now: new Date(now) });

describe('the daily reminder to reconnect (décision du 27/11/2026)', () => {
  it('rings at the agency’s hour for a token that will not last the night, once per day by its key', () => {
    const [ring, ...rest] = due('2026-11-27T17:00:00Z');
    expect(rest).toEqual([]);
    expect(ring?.kind).toBe('daily');
    expect(ring?.objectKey).toBe(`session_reminder:${accountId}:2026-11-27:daily`);
    // A later run of the same window says the same key: the notification is not asked twice.
    expect(due('2026-11-27T17:25:00Z')[0]?.objectKey).toBe(ring?.objectKey);
  });

  it('says when the token dies, and the gesture with the bot’s account', () => {
    const [ring] = due('2026-11-27T17:00:00Z');
    expect(ring?.message.title).toBe('Créatrice Démo · Reconnexion Reveal');
    expect(ring?.message.body).toBe(
      'La session Reveal de l’IA expire à 18 h 05. Dans le profil Chrome de l’IA, reconnecte le « bot » sur Reveal, puis « Synchroniser » dans l’extension.',
    );
    expect(ring?.message.url).toBe('/');
    expect(ring?.message.title.length).toBeLessThanOrEqual(PUSH_TITLE_MAX);
    expect(ring?.message.body?.length).toBeLessThanOrEqual(PUSH_BODY_MAX);
  });

  it('stays quiet for a token synced fresh before the hour', () => {
    expect(due('2026-11-27T17:00:00Z', [clock({ expiresAt: new Date('2026-11-28T16:50:00Z') })])).toEqual([]);
  });

  it('rings for an expired session and for one whose expiry cannot be read', () => {
    const expired = due('2026-11-27T17:00:00Z', [
      clock({ state: 'expired', expiresAt: new Date('2026-11-27T09:00:00Z') }),
    ]);
    expect(expired[0]?.message.body).toMatch(
      /^La session Reveal de l’IA a expiré : l’IA ne lit plus rien\./u,
    );
    const unread = due('2026-11-27T17:00:00Z', [clock({ expiresAt: null })]);
    expect(unread[0]?.message.body).toMatch(/^La session Reveal de l’IA ne dit pas quand elle expire\./u);
  });

  it('rings once more an hour later when nothing changed, and not in between', () => {
    expect(due('2026-11-27T17:40:00Z', [clock({ expiresAt: new Date('2026-11-27T19:00:00Z') })])).toEqual([]);
    const [again] = due('2026-11-27T18:00:00Z', [
      clock({ state: 'expired', expiresAt: new Date('2026-11-27T17:05:00Z') }),
    ]);
    expect(again?.kind).toBe('again');
    expect(again?.objectKey).toBe(`session_reminder:${accountId}:2026-11-27:again`);
    expect(again?.message.title).toBe('Créatrice Démo · Rappel · reconnexion Reveal');
  });

  it('follows the hour the owner set, and the day of a reminder past midnight', () => {
    const tomorrow = clock({ expiresAt: new Date('2026-11-28T10:00:00Z') });
    expect(due('2026-11-27T17:00:00Z', [tomorrow], 9 * 60)).toEqual([]);
    expect(due('2026-11-28T08:00:00Z', [tomorrow], 9 * 60).map((ring) => ring.kind)).toEqual(['daily']);
    // 23 h 50 in Paris, rung again at 0 h 50: the day is still the reminder’s.
    const [again] = due('2026-11-27T23:50:00Z', [clock({ state: 'expired' })], 23 * 60 + 50);
    expect(again?.objectKey).toBe(`session_reminder:${accountId}:2026-11-27:again`);
  });
});

describe('the warning 2 h before a token dies', () => {
  const morning = clock({ expiresAt: new Date('2026-11-28T09:00:00Z') });

  it('rings within the 2 h, once per token', () => {
    expect(due('2026-11-28T06:55:00Z', [morning])).toEqual([]);
    const [ring] = due('2026-11-28T07:00:00Z', [morning]);
    expect(ring?.kind).toBe('before_expiry');
    expect(ring?.objectKey).toBe(`session_reminder:${accountId}:expiry:2026-11-28T09:00:00.000Z`);
    expect(ring?.message.body).toMatch(/^La session Reveal de l’IA expire à 10 h\./u);
    expect(due('2026-11-28T08:30:00Z', [morning])[0]?.objectKey).toBe(ring?.objectKey);
  });

  it('is not said twice when the daily hour falls in those 2 h: the ritual already rang', () => {
    const ritual = clock({ expiresAt: new Date('2026-11-28T17:05:00Z') });
    expect(due('2026-11-28T15:10:00Z', [ritual])).toEqual([]);
    expect(due('2026-11-28T17:00:00Z', [ritual]).map((ring) => ring.kind)).toEqual(['daily']);
  });

  it('says nothing of a token already dead, nor of one without an expiry', () => {
    expect(due('2026-11-28T09:30:00Z', [morning])).toEqual([]);
    expect(due('2026-11-28T08:00:00Z', [clock({ expiresAt: null })])).toEqual([]);
  });
});

describe('the clock as a notification says it', () => {
  it('reads the agency’s zone', () => {
    expect(clockText(new Date('2026-11-27T17:00:00Z'), ZONE)).toBe('18 h');
    expect(clockText(new Date('2026-11-27T17:05:00Z'), ZONE)).toBe('18 h 05');
    expect(clockText(new Date('2026-11-27T23:30:00Z'), ZONE)).toBe('0 h 30');
  });
});
