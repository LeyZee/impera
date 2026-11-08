import {
  DEFAULT_TELEGRAM_CHANNEL_CONFIG,
  RedirectLinkIdSchema,
  type ChannelSlotRole,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { daysWords, issuesOf, nextSlot, postsPerDay, rhythmWords, trimmed } from './model';

const ENGAGEMENT: ChannelSlotRole = 'engagement';
const MAIN: ChannelSlotRole = 'main';
const linkId = RedirectLinkIdSchema.parse('0192f3a0-0000-7000-8000-0000000000e1');

describe('the channel’s screen words (ADR 0080 § 6)', () => {
  it('says the days as people do', () => {
    expect(daysWords([7, 6])).toBe('le week-end');
    expect(daysWords([1, 2, 3, 4, 5])).toBe('en semaine');
    expect(daysWords([3])).toBe('le mercredi');
    expect(daysWords([1, 3, 5])).toBe('lundi, mercredi et vendredi');
  });

  it('says her rhythm, the switched-on slots only', () => {
    expect(rhythmWords(DEFAULT_TELEGRAM_CHANNEL_CONFIG.slots)).toBe('19 h tous les jours');
    expect(rhythmWords([{ minute: 600, role: ENGAGEMENT, days: [1], enabled: false }])).toBe(
      'Aucun post prévu',
    );
  });

  it('offers the main post at 19 h first, then engagement slots', () => {
    expect(nextSlot([])).toMatchObject({ minute: 1140, role: 'main' });
    expect(nextSlot(DEFAULT_TELEGRAM_CHANNEL_CONFIG.slots)?.role).toBe('engagement');
  });

  it('marks a second main post on a day another one holds, a switched-off one not counted', () => {
    const slots = [
      { minute: 12 * 60, role: MAIN, days: [1, 2], enabled: true },
      { minute: 19 * 60, role: MAIN, days: [2], enabled: true },
      { minute: 22 * 60, role: MAIN, days: [3], enabled: true },
    ];
    const issues = issuesOf({ ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, slots });
    expect(issues.get('slot:1')).toBe('Un seul post principal par jour.');
    expect(issues.has('slot:2')).toBe(false);
    const off = slots.map((slot, rank) => ({ ...slot, enabled: rank !== 0 }));
    expect(issuesOf({ ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, slots: off }).has('slot:1')).toBe(false);
  });

  it('offers a slot three hours after the last, across midnight', () => {
    expect(nextSlot([])?.minute).toBe(1140);
    expect(nextSlot([{ minute: 1320, role: ENGAGEMENT, days: [1], enabled: true }])?.minute).toBe(60);
  });

  it('never offers an hour already too close to another slot', () => {
    const slots = [19, 22, 1].map((hour) => ({
      minute: hour * 60,
      role: ENGAGEMENT,
      days: [1],
      enabled: true,
    }));
    // 1 h + 3 h = 4 h is three hours from 1 h, and far from 19 h and 22 h.
    expect(nextSlot(slots)?.minute).toBe(4 * 60);
    const round = [1, 4, 7, 10, 13, 16, 19, 22].map((hour) => ({
      minute: hour * 60,
      role: ENGAGEMENT,
      days: [1],
      enabled: true,
    }));
    expect(nextSlot(round)?.minute).toBe(60);
  });

  it('says where a link leads in words, never by an address', () => {
    const link = {
      id: linkId,
      name: 'TikTok',
      url: 'https://redirect.example.test/t',
      destination: 'tiktok.com/@nora',
    };
    expect(
      issuesOf({ ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, links: [link] }).has(`link:${linkId}:destination`),
    ).toBe(true);
    const fine = { ...link, destination: 'mon live TikTok ce soir 21 h' };
    expect(
      issuesOf({ ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, links: [fine] }).has(`link:${linkId}:destination`),
    ).toBe(false);
  });

  it('refuses a bare domain in the words of the link', () => {
    expect(
      issuesOf({ ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, linkLabel: 'Tout est sur bit.ly/messa' }).get('label'),
    ).toBe('Le texte du lien ne contient pas d’adresse.');
    expect(
      issuesOf({ ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, linkLabel: 'Viens me parler ✨' }).has('label'),
    ).toBe(false);
  });

  it('counts the posts of her busiest day', () => {
    const slots = [8, 12, 16, 20, 23].map((hour) => ({
      minute: hour * 60,
      role: ENGAGEMENT,
      days: [2],
      enabled: true,
    }));
    expect(postsPerDay(slots)).toBe(5);
    expect(issuesOf({ ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, slots }).get('slots')).toBeDefined();
  });

  it('marks a link without a name or with an address that is not https', () => {
    const issues = issuesOf({
      ...DEFAULT_TELEGRAM_CHANNEL_CONFIG,
      links: [{ id: linkId, name: ' ', url: 'http://example.test', destination: '' }],
    });
    expect(issues.has(`link:${linkId}:name`)).toBe(true);
    expect(issues.has(`link:${linkId}:url`)).toBe(true);
  });

  it('marks an empty example, and saves the others trimmed', () => {
    const config = { ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, examples: [' Coucou ✨ ', '  '] };
    expect(issuesOf(config).get('example:1')).toBe('Colle le post, ou retire la ligne.');
    expect(issuesOf(config).has('example:0')).toBe(false);
    expect(trimmed(config).examples).toEqual(['Coucou ✨', '']);
  });
});
