import { DAY_TARGET_MAX } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { canTickDay, DAY_DEFAULTS, dayLines, targetOf } from '../day';

describe('her day (ADR 0140, second avenant of 20/11)', () => {
  it('leads with the essentials: her video, her story that leads to Reveal; never a Reveal story (Charles, 27/11)', () => {
    const lines = dayLines(DAY_DEFAULTS, {});
    expect(lines.filter((line) => line.essential).map((line) => line.item)).toEqual([
      'reveal_video',
      'insta_cta_story',
    ]);
    expect(lines.slice(0, 2).every((line) => line.essential)).toBe(true);
    // Her Reveal story is the feed's video, put out by Impera: nothing for her to post.
    expect(lines.map((line) => line.item)).not.toContain('reveal_story');
  });

  it('asks Charles’s rhythm: 4 Instagram stories with the one to Reveal, 2 posts, a Reel, 3 Telegram posts', () => {
    const targets = Object.fromEntries(dayLines(DAY_DEFAULTS, {}).map((line) => [line.item, line.target]));
    expect(targets).toEqual({
      reveal_video: 1,
      insta_cta_story: 1,
      insta_stories: 3,
      insta_posts: 2,
      insta_reel: 1,
      telegram_posts: 2,
      telegram_video: 1,
    });
  });

  it('says how many in her words', () => {
    const labels = new Map(dayLines(DAY_DEFAULTS, {}).map((line) => [line.item, line.label]));
    expect(labels.get('insta_stories')).toBe('3 autres stories Instagram');
    expect(labels.get('insta_posts')).toBe('2 posts Instagram');
    expect(labels.get('telegram_posts')).toBe('2 posts écrits sur Telegram');
    expect(labels.get('insta_cta_story')).toBe('Ta story qui mène à Reveal');
  });

  it('keeps what comes from Reveal off Instagram, in the words of her video and her posts', () => {
    const sheets = new Map(dayLines(DAY_DEFAULTS, {}).map((line) => [line.item, line.sheet]));
    expect(sheets.get('reveal_video')).toContain('jamais sur Instagram');
    expect(sheets.get('insta_posts')).toContain('Jamais une photo ni une vidéo de Reveal');
    expect(sheets.get('insta_cta_story')).toContain('sticker lien');
  });

  it('counts what she did up to what the line asks, never beyond nor below zero', () => {
    const lines = dayLines(DAY_DEFAULTS, { insta_posts: 5, insta_reel: -1, insta_stories: 2 });
    const done = new Map(lines.map((line) => [line.item, line.done]));
    expect(done.get('insta_posts')).toBe(2);
    expect(done.get('insta_reel')).toBe(0);
    expect(done.get('insta_stories')).toBe(2);
  });

  it('leaves out a line that asks nothing, and never asks more than a day holds', () => {
    const settings = { ...DAY_DEFAULTS, instaStories: 1, instaReels: 0, instaPosts: 40 };
    const items = dayLines(settings, {}).map((line) => line.item);
    expect(items).not.toContain('insta_stories');
    expect(items).not.toContain('insta_reel');
    expect(items).toContain('insta_cta_story');
    expect(targetOf('insta_posts', settings)).toBe(DAY_TARGET_MAX);
  });

  it('lets her tick today and yesterday, never an older day nor a day to come', () => {
    expect(canTickDay('2026-11-20', '2026-11-20')).toBe(true);
    expect(canTickDay('2026-11-19', '2026-11-20')).toBe(true);
    expect(canTickDay('2026-11-18', '2026-11-20')).toBe(false);
    expect(canTickDay('2026-11-21', '2026-11-20')).toBe(false);
    expect(canTickDay('2026-02-28', '2026-03-01')).toBe(true);
  });
});
