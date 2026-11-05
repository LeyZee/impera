import { describe, expect, it } from 'vitest';

import {
  declaredFileRefusal,
  DROP_CATEGORIES,
  DROP_FORMAT_RULES,
  dropCountRefusal,
  kindOfMime,
  probedFileRefusal,
} from './content-drops';

const MB = 1024 * 1024;

describe('the format of a drop, read from the file and never from the image (ADR 0055 § 2)', () => {
  it('takes only the kinds of its category, in her words', () => {
    expect(declaredFileRefusal('instagram_post', { mime: 'video/mp4', bytes: MB })).toBe(
      '« Photo Insta » prend seulement des photos',
    );
    expect(declaredFileRefusal('reveal_story', { mime: 'audio/mpeg', bytes: MB })).toBe(
      '« Story Reveal » prend seulement des photos et des vidéos',
    );
    expect(declaredFileRefusal('mass_dm', { mime: 'audio/x-m4a', bytes: MB })).toBeNull();
  });

  it('a vocal goes only to a relance or a script', () => {
    const takesVocals = DROP_CATEGORIES.filter((category) =>
      DROP_FORMAT_RULES[category].kinds.includes('audio'),
    );
    expect(takesVocals).toEqual(['script', 'mass_dm']);
  });

  it('weighs a photo at 30 Mo and a video at 500 Mo at most', () => {
    expect(declaredFileRefusal('feed_shoot', { mime: 'image/heic', bytes: 30 * MB })).toBeNull();
    expect(declaredFileRefusal('feed_shoot', { mime: 'image/heic', bytes: 30 * MB + 1 })).toBe(
      'Une photo fait au plus 30 Mo',
    );
    expect(declaredFileRefusal('feed_video', { mime: 'video/quicktime', bytes: 500 * MB + 1 })).toBe(
      'Une vidéo fait au plus 500 Mo',
    );
  });

  it('counts the files of a drop: at least one, at most its category’s', () => {
    expect(dropCountRefusal('feed_video', 0)).toBe('Ajoute au moins un fichier');
    expect(dropCountRefusal('instagram_reel', 2)).toBe('« Reel Insta » prend un seul fichier');
    expect(dropCountRefusal('instagram_post', 11)).toBe('« Photo Insta » prend au plus 10 fichiers');
    expect(dropCountRefusal('feed_shoot', 20)).toBeNull();
  });

  it('wants a Reel and a story upright, and never takes an unreadable size for upright', () => {
    const reel = { kind: 'video', durationMs: 30_000 } as const;
    expect(probedFileRefusal('instagram_reel', { ...reel, width: 1080, height: 1920 })).toBeNull();
    expect(probedFileRefusal('instagram_reel', { ...reel, width: 1920, height: 1080 })).toBe(
      '« Reel Insta » : la vidéo doit être verticale',
    );
    expect(probedFileRefusal('instagram_reel', { ...reel, width: null, height: null })).toBe(
      '« Reel Insta » : la vidéo doit être verticale',
    );
    expect(
      probedFileRefusal('reveal_story', { kind: 'image', width: 1000, height: 1000, durationMs: null }),
    ).toBe('« Story Reveal » : la photo doit être verticale');
    // A séance boudoir takes any orientation.
    expect(
      probedFileRefusal('feed_shoot', { kind: 'image', width: 3000, height: 2000, durationMs: null }),
    ).toBeNull();
  });

  it('bounds the length of a video and of a vocal, and refuses one it cannot read', () => {
    const upright = { width: 1080, height: 1920 };
    expect(probedFileRefusal('instagram_reel', { kind: 'video', ...upright, durationMs: 90_000 })).toBeNull();
    expect(probedFileRefusal('instagram_reel', { kind: 'video', ...upright, durationMs: 90_001 })).toBe(
      '« Reel Insta » : une vidéo dure au plus 90 secondes',
    );
    expect(
      probedFileRefusal('mass_dm', { kind: 'audio', width: null, height: null, durationMs: 61_000 }),
    ).toBe('« Relance » : un vocal dure au plus 60 secondes');
    expect(probedFileRefusal('feed_video', { kind: 'video', ...upright, durationMs: null })).toBe(
      '« Feed · Vidéo short » : impossible de lire la durée de ce fichier',
    );
  });

  it('reads the kind of each type a phone sends', () => {
    expect(kindOfMime('image/heif')).toBe('image');
    expect(kindOfMime('video/quicktime')).toBe('video');
    expect(kindOfMime('audio/aac')).toBe('audio');
  });
});
