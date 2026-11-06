import type { ScriptSegment } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { extensionOf, scriptExportPlan } from '../script-export';

/** Invented: a stage, a bridge, a stage with two series and an optional video left empty. */
const segments: ScriptSegment[] = [
  {
    kind: 'stage',
    key: 'salon',
    name: 'Salon',
    intention: 'Elle se dévoile un peu',
    access: 'free',
    mood: null,
    outfit: null,
    place: null,
    mediaSlots: [
      { kind: 'image', optional: false, hint: null },
      { kind: 'video', optional: true, hint: null, minSeconds: 5, maxSeconds: 20 },
    ],
    variants: [],
  },
  {
    kind: 'bridge',
    key: 'vers-chambre',
    from: 'salon',
    to: 'chambre',
    teaser: 'La suite arrive',
    mediaSlots: [],
  },
  {
    kind: 'stage',
    key: 'chambre',
    name: 'Chambre',
    intention: 'Elle se dévoile plus',
    access: 'paid',
    mood: null,
    outfit: null,
    place: null,
    mediaSlots: [{ kind: 'image', optional: false, hint: null }],
    variants: [
      { letter: 'A', hint: 'Lumière tamisée' },
      { letter: 'B', hint: 'Plein jour' },
    ],
  },
];

const file = (slotKey: string, mime: string) => ({
  slotKey,
  mime,
  bytes: 1000,
  storageKey: `media/${slotKey}`,
});

describe('a sent script’s archive (ADR 0056 § 7)', () => {
  const plan = scriptExportPlan({
    number: 7,
    moment: 'night',
    version: { name: 'Soirée inventée', segments },
    files: [
      file('chambre:B:0', 'image/heic'),
      file('salon::0', 'image/jpeg'),
      file('chambre:A:0', 'image/jpeg'),
      file('ailleurs::0', 'image/jpeg'),
    ],
    cards: true,
  });

  it('names its folder and puts every entry in the script’s order, cards at 00, empty slots left out', () => {
    expect(plan.folder).toBe('S007-nuit-soiree-inventee');
    expect(plan.sheetPath).toBe('S007-nuit-soiree-inventee/00-fiche.txt');
    expect(plan.entries.map((entry) => entry.path.slice(plan.folder.length + 1))).toEqual([
      '01-E1-00-carton.png',
      '01-E1-01-photo.jpg',
      '02-P12-00-carton.png',
      '03-E2A-00-carton.png',
      '03-E2A-01-photo.jpg',
      '03-E2B-00-carton.png',
      '03-E2B-01-photo.heic',
    ]);
    expect(plan.entries[1]?.source).toEqual({ kind: 'file', storageKey: 'media/salon::0', bytes: 1000 });
    expect(plan.entries[5]?.source).toEqual({ kind: 'card', segmentKey: 'chambre', variant: 'B' });
  });

  it('keeps the cards out when the agency does', () => {
    const bare = scriptExportPlan({
      number: 7,
      moment: 'day',
      version: { name: 'Soirée inventée', segments },
      files: [file('salon::0', 'image/jpeg')],
      cards: false,
    });
    expect(bare.entries.map((entry) => entry.path)).toEqual(['S007-jour-soiree-inventee/01-E1-01-photo.jpg']);
  });

  it('writes a sheet to copy, step by step, with each series and its files', () => {
    expect(plan.sheet).toContain('01 · E1 — Salon (GRATUIT)');
    expect(plan.sheet).toContain('02 · P12 — Pont (GRATUIT)');
    expect(plan.sheet).toContain('03 · E2 — Chambre (PAYANT)');
    expect(plan.sheet).toContain(
      '   Série B : Plein jour\n     03-E2B-00-carton.png\n     03-E2B-01-photo.heic',
    );
    expect(plan.sheet.endsWith('\n')).toBe(true);
  });

  it('knows the extension of every type a drop keeps', () => {
    expect(extensionOf('video/mp4')).toBe('mp4');
    expect(extensionOf('audio/mpeg')).toBe('mp3');
    expect(extensionOf('application/pdf')).toBe('bin');
  });
});
