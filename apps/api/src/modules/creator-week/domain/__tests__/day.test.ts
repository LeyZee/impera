import { DAY_TARGET_MAX } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { canTickDay, DAY_DEFAULTS, dayLines, isTicked, targetOf } from '../day';

const NONE = { ticked: {}, videos: 0 };

describe('her day (ADR 0140, second avenant of 20/11)', () => {
  it('leads with the essentials: her video, her story that leads to Reveal; never a Reveal story (Charles, 27/11)', () => {
    const lines = dayLines(DAY_DEFAULTS, NONE);
    expect(lines.filter((line) => line.essential).map((line) => line.item)).toEqual([
      'reveal_video',
      'insta_cta_story',
    ]);
    expect(lines.slice(0, 2).every((line) => line.essential)).toBe(true);
    // Her Reveal story is the feed's video, put out by Impera: nothing for her to post.
    expect(lines.map((line) => line.item)).not.toContain('reveal_story');
  });

  it('asks Charles’s rhythm: 4 Instagram stories with the one to Reveal, 2 posts, a Reel, 3 Telegram posts', () => {
    const targets = Object.fromEntries(dayLines(DAY_DEFAULTS, NONE).map((line) => [line.item, line.target]));
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
    const labels = new Map(dayLines(DAY_DEFAULTS, NONE).map((line) => [line.item, line.label]));
    expect(labels.get('insta_stories')).toBe('3 autres stories Instagram');
    expect(labels.get('insta_posts')).toBe('2 posts Instagram');
    expect(labels.get('telegram_posts')).toBe('2 posts écrits sur Telegram');
    expect(labels.get('insta_cta_story')).toBe('Ta story qui mène à Reveal');
  });

  it('keeps what comes from Reveal off Instagram, in the words of her video and her posts', () => {
    const sheets = new Map(dayLines(DAY_DEFAULTS, NONE).map((line) => [line.item, line.sheet]));
    expect(sheets.get('reveal_video')).toContain('jamais sur Instagram');
    expect(sheets.get('insta_posts')).toContain('Jamais une photo ni une vidéo de Reveal');
    expect(sheets.get('insta_cta_story')).toContain('sticker lien');
  });

  it('counts what she did up to what the line asks, never beyond nor below zero', () => {
    const lines = dayLines(DAY_DEFAULTS, {
      ticked: { insta_posts: 5, insta_reel: -1, insta_stories: 2 },
      videos: 0,
    });
    const done = new Map(lines.map((line) => [line.item, line.done]));
    expect(done.get('insta_posts')).toBe(2);
    expect(done.get('insta_reel')).toBe(0);
    expect(done.get('insta_stories')).toBe(2);
  });

  it('leaves out a line that asks nothing, and never asks more than a day holds', () => {
    const settings = { ...DAY_DEFAULTS, instaStories: 1, instaReels: 0, instaPosts: 40 };
    const items = dayLines(settings, NONE).map((line) => line.item);
    expect(items).not.toContain('insta_stories');
    expect(items).not.toContain('insta_reel');
    expect(items).toContain('insta_cta_story');
    expect(targetOf('insta_posts', settings)).toBe(DAY_TARGET_MAX);
  });

  it('does her video of the day by her coffre, never by a tick (avenant du 27/11 : « elle dépose, Impera planifie »)', () => {
    const video = (ticked: number, videos: number) =>
      dayLines(DAY_DEFAULTS, { ticked: { reveal_video: ticked, insta_cta_story: 1 }, videos }).find(
        (line) => line.item === 'reveal_video',
      );
    expect(video(1, 0)).toMatchObject({ done: 0, source: 'drop' });
    expect(video(0, 3)).toMatchObject({ done: 1, target: 1 });
    expect(isTicked('reveal_video')).toBe(false);
    // Her story that leads to Reveal is posted by her on Instagram: still a tick.
    const cta = dayLines(DAY_DEFAULTS, { ticked: { insta_cta_story: 1 }, videos: 0 }).find(
      (line) => line.item === 'insta_cta_story',
    );
    expect(cta).toMatchObject({ done: 1, source: 'tick' });
    expect(isTicked('insta_cta_story')).toBe(true);
  });

  it('lets her tick today and yesterday, never an older day nor a day to come', () => {
    expect(canTickDay('2026-11-20', '2026-11-20')).toBe(true);
    expect(canTickDay('2026-11-19', '2026-11-20')).toBe(true);
    expect(canTickDay('2026-11-18', '2026-11-20')).toBe(false);
    expect(canTickDay('2026-11-21', '2026-11-20')).toBe(false);
    expect(canTickDay('2026-02-28', '2026-03-01')).toBe(true);
  });
});
