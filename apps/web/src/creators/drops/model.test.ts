import { describe, expect, it } from 'vitest';

import { herDrops, holdsLine, summaryLine } from './model';

import { dropOf, fileOf, requestOf } from '@/screens/content/fixtures';

/* Invented drops (ADR 0010). */
const content = (drops: ReturnType<typeof dropOf>[]) => ({ requests: [requestOf()], drops });

describe('Créatrices › Contenu (recette créatrice 1)', () => {
  it('lists her drops but her scripts and the withdrawn ones, the latest first, each where it stands', () => {
    const seance = dropOf({
      category: 'feed_shoot',
      sentence: 'Au salon',
      files: [
        fileOf(),
        fileOf({ kind: 'video', mime: 'video/mp4', bytes: 9_000_000 }),
        fileOf({ state: 'refused', refusal: 'Floue' }),
      ],
      createdAt: '2026-11-09T10:00:00.000Z',
    });
    const story = dropOf({
      category: 'reveal_story',
      state: 'received',
      createdAt: '2026-11-10T10:00:00.000Z',
    });
    const relance = dropOf({
      category: 'mass_dm',
      files: [fileOf({ kind: 'audio', mime: 'audio/mp4', bytes: 300_000 })],
      exportedAt: '2026-11-08T12:00:00.000Z',
      createdAt: '2026-11-08T10:00:00.000Z',
    });
    const blocked = dropOf({
      category: 'instagram_post',
      state: 'blocked',
      blockedReason: 'Aucun fichier gardé',
      createdAt: '2026-11-07T10:00:00.000Z',
    });
    const gone = dropOf({
      category: 'feed_video',
      state: 'withdrawn',
      createdAt: '2026-11-11T10:00:00.000Z',
    });
    const script = dropOf({
      category: 'script',
      scriptNumber: 1,
      requestId: requestOf({ category: 'script' }).id,
    });
    const rows = herDrops(content([seance, story, relance, blocked, gone, script]));
    expect(rows.map((row) => [row.label, row.standing])).toEqual([
      ['Story Reveal', 'checking'],
      ['Feed · Séance boudoir', 'to_publish'],
      ['Relance', 'out'],
      ['Photo Insta', 'blocked'],
    ]);
    expect(rows[1]).toMatchObject({
      photos: 1,
      videos: 1,
      vocals: 0,
      bytes: 13_000_000,
      sentence: 'Au salon',
    });
    expect(rows[2]?.originalsUntil).toBe('2026-12-08T12:00:00.000Z');
    expect(summaryLine(rows)).toBe('4 dépôts · 1 à publier');
    expect(summaryLine([rows[2]].flatMap((row) => (row === undefined ? [] : [row])))).toBe(
      '1 dépôt · tous publiés',
    );
  });

  it('says what a drop holds', () => {
    expect(holdsLine({ photos: 2, videos: 1, vocals: 0, bytes: 13_000_000 })).toBe(
      '2 photos · 1 vidéo · 13 Mo',
    );
    expect(holdsLine({ photos: 0, videos: 0, vocals: 2, bytes: 1_500_000_000 })).toBe('2 vocaux · 1,5 Go');
    expect(holdsLine({ photos: 0, videos: 0, vocals: 0, bytes: 0 })).toBe('Aucun média gardé');
  });
});
