import { DEFAULT_TELEGRAM_CHANNEL_CONFIG, RedirectLinkIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { daysWords, issuesOf, linkPreview, nextSlot, postsPerDay, rhythmWords } from './model';

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
    expect(rhythmWords([{ minute: 600, days: [1], enabled: false }])).toBe('Aucun post prévu');
  });

  it('offers a slot three hours after the last, across midnight', () => {
    expect(nextSlot([])?.minute).toBe(1140);
    expect(nextSlot([{ minute: 1320, days: [1], enabled: true }])?.minute).toBe(60);
  });

  it('never offers an hour already too close to another slot', () => {
    const slots = [19, 22, 1].map((hour) => ({ minute: hour * 60, days: [1], enabled: true }));
    // 1 h + 3 h = 4 h is three hours from 1 h, and far from 19 h and 22 h.
    expect(nextSlot(slots)?.minute).toBe(4 * 60);
    const round = [1, 4, 7, 10, 13, 16, 19, 22].map((hour) => ({
      minute: hour * 60,
      days: [1],
      enabled: true,
    }));
    expect(nextSlot(round)?.minute).toBe(60);
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
    const slots = [8, 12, 16, 20, 23].map((hour) => ({ minute: hour * 60, days: [2], enabled: true }));
    expect(postsPerDay(slots)).toBe(5);
    expect(issuesOf({ ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, slots }).get('slots')).toBeDefined();
  });

  it('marks a link without a name or with an address that is not https', () => {
    const issues = issuesOf({
      ...DEFAULT_TELEGRAM_CHANNEL_CONFIG,
      links: [{ id: linkId, name: ' ', url: 'http://example.test' }],
    });
    expect(issues.has(`link:${linkId}:name`)).toBe(true);
    expect(issues.has(`link:${linkId}:url`)).toBe(true);
  });

  it('shows the end of a post with the text, or the bare address', () => {
    const config = {
      ...DEFAULT_TELEGRAM_CHANNEL_CONFIG,
      links: [{ id: linkId, name: 'Telegram', url: 'https://redirect.example.test/a' }],
      channelLinkId: linkId,
    };
    expect(linkPreview(config)?.text).toBe('Viens me parler ✨');
    expect(linkPreview({ ...config, linkForm: 'bare' })?.text).toBe('https://redirect.example.test/a');
    expect(linkPreview({ ...config, channelLinkId: null })).toBeNull();
  });
});
