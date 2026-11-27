import { SCRIPT_EXPORT_MAX_BYTES } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { dropExportPlan, dropFitsInOneArchive, type SentDrop } from '../drop-export';

/** An invented drop of the feed (ADR 0010): two photos and a video, her word, made late at night in Paris. */
const drop: SentDrop = {
  category: 'feed_shoot',
  createdAt: new Date('2026-11-10T23:30:00.000Z'),
  timezone: 'Europe/Paris',
  sentence: 'Une séance  inventée,\nau salon',
  files: [
    {
      kind: 'image',
      mime: 'image/jpeg',
      bytes: 10,
      storageKey: 'k/1',
      description: 'Une photo inventée.',
      inScript: false,
    },
    { kind: 'image', mime: 'image/heic', bytes: 10, storageKey: 'k/2', description: null, inScript: false },
    {
      kind: 'video',
      mime: 'video/mp4',
      bytes: 10,
      storageKey: 'k/3',
      description: 'Une vidéo\ninventée.',
      inScript: false,
    },
  ],
};

describe('dropExportPlan (recette créatrice 1)', () => {
  it('names her folder by its category and her day, the sheet first, her media in her order', () => {
    const plan = dropExportPlan(drop);
    // 23 h 30 UTC is already the 11th in Paris.
    expect(plan.folder).toBe('feed-seance-2026-11-11');
    expect(plan.sheetPath).toBe('feed-seance-2026-11-11/00-fiche.txt');
    expect(plan.entries).toEqual([
      { path: 'feed-seance-2026-11-11/01-photo.jpg', storageKey: 'k/1' },
      { path: 'feed-seance-2026-11-11/02-photo.heic', storageKey: 'k/2' },
      { path: 'feed-seance-2026-11-11/03-video.mp4', storageKey: 'k/3' },
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
        '01-photo.jpg',
        '   Une photo inventée.',
        '02-photo.heic',
        '   Description à valider dans le CRM.',
        '03-video.mp4',
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
        },
      ],
    });
    expect(plan.folder).toBe('relance-2026-11-11');
    expect(plan.sheet).toBe(
      [
        'Relance du 11 novembre 2026',
        '',
        'À ranger dans Reveal pour ses relances, dans cet ordre.',
        '',
        '01-vocal.m4a',
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
      { path: 'feed-seance-2026-11-11/01-photo.jpg', storageKey: 'k/1' },
      { path: 'feed-seance-2026-11-11/02-video.mp4', storageKey: 'k/3' },
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

  it('holds in one archive what a script’s archive holds, no more', () => {
    const file = {
      kind: 'video',
      mime: 'video/mp4',
      storageKey: 'k',
      description: null,
      inScript: false,
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
