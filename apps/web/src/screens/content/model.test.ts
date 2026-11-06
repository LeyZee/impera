import { describe, expect, it } from 'vitest';

import { dropOf, fileOf, requestOf } from './fixtures';
import {
  acceptOf,
  contentsOf,
  droppedOn,
  dueOf,
  fileLine,
  mimeOf,
  moved,
  onTheirWay,
  openRequests,
  published,
  mayWithdrawHere,
  refusedOf,
  remainingOf,
  sameFile,
  shotMomentOf,
  stateTone,
  weightOf,
} from './model';

describe('Contenu: the rules of her screen (CR-06 d)', () => {
  it('reads a file’s type from her browser, or from its extension when the browser gives none', () => {
    expect(mimeOf({ name: 'IMG_0001.MOV', type: 'video/quicktime' })).toBe('video/quicktime');
    expect(mimeOf({ name: 'clip.mkv', type: '' })).toBe('video/x-matroska');
    expect(mimeOf({ name: 'photo.HEIC', type: '' })).toBe('image/heic');
    expect(mimeOf({ name: 'notes.pdf', type: 'application/pdf' })).toBeNull();
  });

  it('offers in the gallery only what the category takes', () => {
    expect(acceptOf('feed_video')).not.toContain('image/*');
    expect(acceptOf('feed_video')).toContain('.mkv');
    expect(acceptOf('mass_dm')).toContain('audio/*');
  });

  it('lists her open requests, the nearest first, without those a drop already answers', () => {
    const later = requestOf({ dueOn: '2026-11-10' });
    const sooner = requestOf({ dueOn: '2026-11-06' });
    const answered = requestOf({ dueOn: '2026-11-05', dropId: dropOf().id });
    const refused = requestOf({ state: 'refused' });
    expect(openRequests([later, answered, sooner, refused]).map((r) => r.id)).toEqual([sooner.id, later.id]);
  });

  it('puts a drop on its way until it is out, and never shows a withdrawn one', () => {
    const drops = [
      dropOf({ state: 'uploading' }),
      dropOf({ state: 'published' }),
      dropOf({ state: 'withdrawn' }),
      dropOf({ state: 'blocked', blockedReason: '« Vidéo feed » : la vidéo doit être verticale' }),
    ];
    expect(onTheirWay(drops).map((d) => d.state)).toEqual(['uploading', 'blocked']);
    expect(published(drops).map((d) => d.state)).toEqual(['published']);
  });

  it('turns amber only a blocked drop: she has something to do', () => {
    expect(stateTone(dropOf({ state: 'blocked', blockedReason: 'x' }))).toBe('warn');
    expect(stateTone(dropOf({ state: 'received' }))).toBe('calm');
    expect(stateTone(dropOf({ state: 'ready' }))).toBe('ok');
  });

  it('says what a drop holds, by kind', () => {
    const files = [
      fileOf({ kind: 'video' }),
      fileOf({ kind: 'image' }),
      fileOf({ kind: 'image' }),
      fileOf({ kind: 'audio' }),
    ];
    expect(contentsOf(files)).toBe('2 photos · 1 vidéo · 1 vocal');
  });

  it('says where each file is: its progress here, « En préparation » while it is cleaned or converted', () => {
    const awaiting = fileOf({ state: 'awaiting' });
    expect(fileLine(awaiting, undefined)).toBe('Envoi interrompu');
    expect(fileLine(awaiting, { sent: 0, total: 10, rate: null, phase: 'queued' })).toBe('En attente');
    expect(fileLine(awaiting, { sent: 500, total: 1000, rate: null, phase: 'sending' })).toBe('50 %');
    expect(
      fileLine(awaiting, { sent: 500_000_000, total: 1_000_000_000, rate: 5_000_000, phase: 'sending' }),
    ).toBe('50 % · encore 2 min');
    expect(fileLine(awaiting, { sent: 5, total: 10, rate: 1, phase: 'waiting' })).toBe(
      'Réseau coupé : ça reprend tout seul',
    );
    expect(fileLine(fileOf({ state: 'received' }), undefined)).toBe('En préparation');
    expect(fileLine(fileOf({ state: 'duplicate' }), undefined)).toBe('Déjà dans ta médiathèque');
    expect(fileLine(fileOf({ state: 'refused', refusal: 'Une photo fait au plus 30 Mo' }), undefined)).toBe(
      'Une photo fait au plus 30 Mo',
    );
  });

  it('says weights and times as she reads them', () => {
    expect(weightOf(340_000_000)).toBe('340 Mo');
    expect(weightOf(1_200_000_000)).toBe('1,2 Go');
    // Under a megabyte, in Ko: never « 1 Mo » for a photo of 9 Ko or an empty file (recette MED-02).
    expect(weightOf(8_894)).toBe('9 Ko');
    expect(weightOf(0)).toBe('0 Ko');
    expect(weightOf(300)).toBe('1 Ko');
    expect(weightOf(999_600)).toBe('1 Mo');
    expect(remainingOf(42)).toBe('40 s');
    expect(remainingOf(3900)).toBe('1 h 05');
  });

  it('keeps each refused file of a settled drop, with its reason, and only then (recette MED-03)', () => {
    const refused = fileOf({
      state: 'refused',
      refusal: '« Feed · Vidéo short » : la vidéo doit être verticale',
    });
    const kept = fileOf({ state: 'kept' });
    expect(refusedOf(dropOf({ state: 'blocked', files: [refused] }))).toEqual([refused]);
    expect(refusedOf(dropOf({ state: 'ready', files: [kept, refused] }))).toEqual([refused]);
    expect(refusedOf(dropOf({ state: 'ready', files: [kept] }))).toEqual([]);
    expect(refusedOf(dropOf({ state: 'uploading', files: [refused] }))).toEqual([]);
  });

  it('offers « Retirer » on a drop she may withdraw, never on a script copied into Reveal (recette MED-08)', () => {
    expect(mayWithdrawHere(dropOf({ state: 'ready' }))).toBe(true);
    expect(mayWithdrawHere(dropOf({ state: 'ready', exportedAt: '2026-11-06T17:57:40.993Z' }))).toBe(false);
  });

  it('says when a script asked of her is shot, as its request fixed (recette MED-05)', () => {
    expect(shotMomentOf(requestOf({ category: 'script', moment: 'night' }))).toBe('🌙 Nuit');
    expect(shotMomentOf(requestOf({ category: 'script', moment: 'day' }))).toBe('☀️ Jour');
    expect(shotMomentOf(requestOf({ category: 'script', moment: null }))).toBeNull();
    expect(shotMomentOf(requestOf({ category: 'feed_shoot', moment: null }))).toBeNull();
  });

  it('says when a request is due, and since when it is late', () => {
    // 05/11/2026 is a Thursday.
    expect(dueOf('2026-11-05', '2026-11-05')).toEqual({ text: 'Pour aujourd’hui', late: false });
    expect(dueOf('2026-11-06', '2026-11-05')).toEqual({ text: 'Pour demain', late: false });
    expect(dueOf('2026-11-09', '2026-11-05')).toEqual({ text: 'Pour lundi', late: false });
    expect(dueOf('2026-11-20', '2026-11-05')).toEqual({ text: 'Pour le 20 nov.', late: false });
    expect(dueOf('2026-11-02', '2026-11-05')).toEqual({ text: 'En retard depuis lundi', late: true });
  });

  it('says when she dropped it, in her own time', () => {
    expect(droppedOn('2026-11-04T23:30:00Z', '2026-11-05', 'Europe/Paris')).toBe('Aujourd’hui');
    expect(droppedOn('2026-11-04T10:00:00Z', '2026-11-05', 'Europe/Paris')).toBe('Hier');
    expect(droppedOn('2026-11-02T10:00:00Z', '2026-11-05', 'Europe/Paris')).toBe('Lundi');
  });

  it('moves a file one place up or down, and never past either end', () => {
    expect(moved(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moved(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moved(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moved(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('knows the same file picked twice', () => {
    const file = { name: 'IMG_1.HEIC', size: 3, lastModified: 1 };
    expect(sameFile(file, { ...file })).toBe(true);
    expect(sameFile(file, { ...file, lastModified: 2 })).toBe(false);
  });
});
