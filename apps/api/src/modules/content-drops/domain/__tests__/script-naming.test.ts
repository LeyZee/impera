import type { MediaSlot, ScriptSegment } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  namingExtension,
  namingSlug,
  scriptFileName,
  scriptFolderEntries,
  scriptFolderName,
} from '../script-naming';

const photo: MediaSlot = { kind: 'image', optional: false, hint: null };
const video: MediaSlot = { kind: 'video', optional: true, hint: null, minSeconds: 30, maxSeconds: 90 };
const voice: MediaSlot = { kind: 'audio', optional: false, hint: null, maxSeconds: 60 };

const stage = (key: string, mediaSlots: MediaSlot[], letters: ('A' | 'B' | 'C')[] = []): ScriptSegment => ({
  kind: 'stage',
  key,
  name: key,
  intention: 'Elle se dévoile un peu',
  access: 'paid',
  mood: null,
  outfit: null,
  place: null,
  mediaSlots,
  variants: letters.map((letter) => ({ letter, hint: `Prise ${letter}` })),
});

const bridge = (key: string, from: string, to: string, mediaSlots: MediaSlot[] = [photo]): ScriptSegment => ({
  kind: 'bridge',
  key,
  from,
  to,
  teaser: 'La suite arrive',
  mediaSlots,
});

/** Invented: bridges, a stage with three series, a bridge without a medium, more than nine slots in one stage. */
const segments: ScriptSegment[] = [
  stage('accueil', [photo, photo]),
  bridge('vers-salon', 'accueil', 'salon'),
  stage('salon', [photo, video], ['A', 'B', 'C']),
  bridge('vers-chambre', 'salon', 'chambre', []),
  stage('chambre', [photo, photo, photo, photo, photo, photo, photo, photo, photo, photo, video, voice]),
];

const sorted = (names: readonly string[]): string[] => names.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));

describe('script naming (ADR 0056 § 5)', () => {
  it('names the folder S<nnn>-<moment>-<theme>, the number on three digits', () => {
    expect(scriptFolderName(14, 'night', 'Salon')).toBe('S014-nuit-salon');
    expect(scriptFolderName(3, 'day', 'Été au bord de l’eau 🌊')).toBe('S003-jour-ete-au-bord-de-l-eau');
    expect(() => scriptFolderName(0, 'day', 'Salon')).toThrow(RangeError);
  });

  it('keeps a slug in lowercase ASCII and hyphens, never empty', () => {
    expect(namingSlug('  Douche — Crème & Sel !  ')).toBe('douche-creme-sel');
    expect(namingSlug('🔥🔥')).toBe('script');
    expect(namingSlug('a'.repeat(39) + ' bcd')).toBe('a'.repeat(39));
  });

  it('gives every file its segment, code, place and kind, 00 kept for the card', () => {
    const stems = scriptFolderEntries(segments, { cards: true }).map((entry) => entry.stem);
    expect(stems.slice(0, 7)).toEqual([
      '01-E1-00-carton',
      '01-E1-01-photo',
      '01-E1-02-photo',
      '02-P12-00-carton',
      '02-P12-01-photo',
      '03-E2A-00-carton',
      '03-E2A-01-photo',
    ]);
    expect(stems).toContain('03-E2C-02-video');
    expect(stems).toContain('04-P23-00-carton');
    expect(stems.at(-1)).toBe('05-E3-12-vocal');
    const media = scriptFolderEntries(segments, { cards: true }).filter((entry) => entry.slotKey !== null);
    expect(media.every((entry) => entry.place >= 1 && !entry.stem.includes('-00-'))).toBe(true);
  });

  it('sorts alphabetically in the script’s order, with or without cards', () => {
    for (const cards of [true, false]) {
      const names = scriptFolderEntries(segments, { cards }).map((entry) =>
        scriptFileName(entry, entry.kind === 'carton' ? 'png' : entry.kind === 'video' ? 'mp4' : 'jpg'),
      );
      expect(sorted(names)).toEqual(names);
    }
  });

  it('leaves the cards out when the agency does', () => {
    const entries = scriptFolderEntries(segments, { cards: false });
    expect(entries.some((entry) => entry.kind === 'carton')).toBe(false);
    expect(entries.map((entry) => entry.slotKey)).not.toContain(null);
  });

  it('has no space, accent or emoji in a name', () => {
    const names = scriptFolderEntries(segments, { cards: true }).map((entry) =>
      scriptFileName(entry, '.JPG'),
    );
    expect(
      names.every((name) => /^\d{2}-[EP][0-9A-C?]+-\d{2}-(carton|photo|video|vocal)\.jpg$/u.test(name)),
    ).toBe(true);
    expect(namingExtension('')).toBe('bin');
  });
});
