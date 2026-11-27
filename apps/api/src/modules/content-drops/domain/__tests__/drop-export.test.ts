import { SCRIPT_EXPORT_MAX_BYTES } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { dropExportPlan, dropFitsInOneArchive, type SentDrop } from '../drop-export';

/** An invented drop of the feed (ADR 0010): two photos and a video, her word, made late at night in Paris. */
const drop: SentDrop = {
  category: 'feed_shoot',
  createdAt: new Date('2026-11-10T23:30:00.000Z'),
  timezone: 'Europe/Paris',
  dayRank: 1,
  sentence: 'Une séance  inventée,\nau salon',
  files: [
    {
      kind: 'image',
      mime: 'image/jpeg',
      bytes: 10,
      storageKey: 'k/1',
      description: 'Une photo inventée.',
      inScript: false,
      durationMs: null,
      version: 1,
    },
    {
      kind: 'image',
      mime: 'image/heic',
      bytes: 10,
      storageKey: 'k/2',
      description: null,
      inScript: false,
      durationMs: null,
      version: 1,
    },
    {
      kind: 'video',
      mime: 'video/mp4',
      bytes: 10,
      storageKey: 'k/3',
      description: 'Une vidéo\ninventée.',
      inScript: false,
      durationMs: null,
      version: 1,
    },
  ],
};

describe('dropExportPlan (recette créatrice 1)', () => {
  it('names her folder by its category and her day, the sheet first, her media in her order', () => {
    const plan = dropExportPlan(drop);
    // 23 h 30 UTC is already the 11th in Paris.
    expect(plan.folder).toBe('feed-seance-2026-11-11-1');
    expect(plan.sheetPath).toBe('feed-seance-2026-11-11-1/00-fiche.txt');
    expect(plan.entries).toEqual([
      { path: 'feed-seance-2026-11-11-1/feed-seance-2026-11-11-1-01-photo.jpg', storageKey: 'k/1' },
      { path: 'feed-seance-2026-11-11-1/feed-seance-2026-11-11-1-02-photo.heic', storageKey: 'k/2' },
      { path: 'feed-seance-2026-11-11-1/feed-seance-2026-11-11-1-03-video.mp4', storageKey: 'k/3' },
    ]);
  });

  it('writes her word and each validated description, never one not validated', () => {
    expect(dropExportPlan(drop).sheet).toBe(
      [
        'Feed · Séance boudoir du 11 novembre 2026',
        'Son mot : Une séance inventée, au salon',
        '',
        'À publier sur son feed Reveal, en une seule publication, dans cet ordre.',
        '',
        'feed-seance-2026-11-11-1-01-photo.jpg',
        '   Une photo inventée.',
        'feed-seance-2026-11-11-1-02-photo.heic',
        '   Description à valider dans le CRM.',
        'feed-seance-2026-11-11-1-03-video.mp4',
        '   Une vidéo inventée.',
        '',
      ].join('\n'),
    );
  });

  it('says where a relance goes, and that a vocal is listened to', () => {
    const plan = dropExportPlan({
      ...drop,
      category: 'mass_dm',
      sentence: null,
      files: [
        {
          kind: 'audio',
          mime: 'audio/mp4',
          bytes: 10,
          storageKey: 'k/4',
          description: null,
          inScript: false,
          durationMs: null,
          version: 1,
        },
      ],
    });
    expect(plan.folder).toBe('relance-2026-11-11-1');
    expect(plan.sheet).toBe(
      [
        'Relance du 11 novembre 2026',
        '',
        'À ranger dans Reveal pour ses relances, dans cet ordre.',
        '',
        'relance-2026-11-11-1-01-vocal.m4a',
        '   Note vocale : à écouter.',
        '',
      ].join('\n'),
    );
  });

  it('never puts in a free drop a medium one of her scripts sells, and says so (ADR 0145 § 2)', () => {
    const [first, second, third] = drop.files;
    if (first === undefined || second === undefined || third === undefined) throw new Error('fixture');
    const plan = dropExportPlan({ ...drop, files: [first, { ...second, inScript: true }, third] });
    // The others keep her order, numbered without a hole.
    expect(plan.entries).toEqual([
      { path: 'feed-seance-2026-11-11-1/feed-seance-2026-11-11-1-01-photo.jpg', storageKey: 'k/1' },
      { path: 'feed-seance-2026-11-11-1/feed-seance-2026-11-11-1-02-video.mp4', storageKey: 'k/3' },
    ]);
    expect(plan.sheet).toContain(
      'Un média est laissé de côté : il est vendu dans un de ses scripts, il ne part jamais offert.',
    );
    expect(plan.sheet).not.toContain('heic');
    const all = dropExportPlan({
      ...drop,
      category: 'mass_dm',
      files: drop.files.map((file) => ({ ...file, inScript: true })),
    });
    expect(all.entries).toEqual([]);
    expect(all.sheet).toContain('3 médias sont laissés de côté');
  });

  it('numbers her drops of a day, and names each file in full: its length, and the version sent again (Charles, 26/11)', () => {
    const [photo, , video] = drop.files;
    if (photo === undefined || video === undefined) throw new Error('fixture');
    const plan = dropExportPlan({
      ...drop,
      dayRank: 2,
      files: [
        { ...photo, version: 2 },
        { ...video, durationMs: 37_600 },
        { ...video, kind: 'audio', mime: 'audio/mp4', durationMs: 300 },
      ],
    });
    const folder = 'feed-seance-2026-11-11-2';
    expect(plan.entries.map((entry) => entry.path)).toEqual([
      `${folder}/${folder}-01-photo-v2.jpg`,
      `${folder}/${folder}-02-video-38s.mp4`,
      `${folder}/${folder}-03-vocal-1s.m4a`,
    ]);
    // Plain ASCII, never a space: every system reads it.
    expect(plan.entries.every((entry) => /^[a-z0-9./-]+$/u.test(entry.path))).toBe(true);
  });

  it('holds in one archive what a script’s archive holds, no more', () => {
    const file = {
      kind: 'video',
      mime: 'video/mp4',
      storageKey: 'k',
      description: null,
      inScript: false,
      durationMs: null,
      version: 1,
    } as const;
    expect(dropFitsInOneArchive([{ ...file, bytes: SCRIPT_EXPORT_MAX_BYTES }])).toBe(true);
    expect(
      dropFitsInOneArchive([
        { ...file, bytes: SCRIPT_EXPORT_MAX_BYTES },
        { ...file, bytes: 1 },
      ]),
    ).toBe(false);
  });
});
