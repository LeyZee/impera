import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ScriptStructureVersionIdSchema,
  newId,
  type MediaSlot,
  type ScriptStructureVersion,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { CARD_PALETTES, cardContent, cardSvg, duration, shootSummary, wrap } from '../cards';

const NBSP = ' ';
const plain = (text: string): string => text.replaceAll(NBSP, ' ');

/** An invented structure: never a real one of the agency in the repository (SC-01). */
const version: ScriptStructureVersion = {
  id: newId(ScriptStructureVersionIdSchema),
  version: 1,
  name: 'Soirée au salon',
  moment: 'night',
  frozen: false,
  updatedAt: '2026-11-03T10:00:00.000Z',
  segments: [
    {
      kind: 'stage',
      key: 'canape',
      name: 'Canapé',
      intention: 'Elle se dévoile doucement',
      mood: 'Lumière tamisée',
      mediaSlots: [
        { kind: 'image', optional: false, hint: 'Assise, jambes croisées' },
        { kind: 'image', optional: false, hint: null },
        {
          kind: 'video',
          optional: false,
          hint: 'Face caméra <chuchote> & sourit',
          minSeconds: 60,
          maxSeconds: 120,
        },
      ],
      variants: [
        { letter: 'A', hint: 'Robe noire' },
        { letter: 'B', hint: 'Robe rouge' },
      ],
    },
    { kind: 'bridge', key: 'canape-lit', from: 'canape', to: 'lit', teaser: 'On passe à côté ?' },
    {
      kind: 'stage',
      key: 'lit',
      name: 'Lit',
      intention: 'Plus près',
      mood: null,
      mediaSlots: [{ kind: 'image', optional: false, hint: null }],
      variants: [],
    },
  ],
};

describe('shootSummary', () => {
  const image = (optional = false): MediaSlot => ({ kind: 'image', optional, hint: null });
  const video = (minSeconds: number, maxSeconds: number): MediaSlot => ({
    kind: 'video',
    optional: false,
    hint: null,
    minSeconds,
    maxSeconds,
  });

  it('gathers the same kinds in the order they first come', () => {
    expect(plain(shootSummary([image(), video(60, 120), image(), image()]))).toBe(
      '3 photos, 1 vidéo de 1 à 2 min',
    );
    expect(plain(shootSummary([video(45, 90), video(45, 90), video(30, 30)]))).toBe(
      '2 vidéos de 45 s à 1 min 30, 1 vidéo de 30 s',
    );
  });

  it('says the optional ones after, and a voice note’s longest', () => {
    expect(
      plain(shootSummary([image(), { kind: 'audio', optional: true, hint: null, maxSeconds: 30 }])),
    ).toBe('1 photo + 1 vocal de 30 s max en option');
    expect(plain(shootSummary([image(true)]))).toBe('1 photo en option');
  });

  it('keeps a number with its unit', () => {
    expect(duration(90)).toBe(`1${NBSP}min${NBSP}30`);
    expect(wrap(`1 vidéo de 1${NBSP}à 2${NBSP}min`, 12, 3)).toEqual(['1 vidéo de', `1${NBSP}à 2${NBSP}min`]);
  });
});

describe('wrap', () => {
  it('cuts on words and ends a cut text with an ellipsis', () => {
    expect(wrap('Tu veux voir la suite dans la chambre ?', 16, 2)).toEqual([
      'Tu veux voir la',
      'suite dans la…',
    ]);
    expect(wrap('court', 16, 2)).toEqual(['court']);
  });
});

describe('cardContent', () => {
  it('says a stage’s number, what to shoot, its sentence and its hints', () => {
    const card = cardContent(version, 'canape', { theme: 'night' });
    expect(card).toMatchObject({
      kicker: 'Étape 1',
      moment: 'Nuit',
      title: 'Canapé',
      mood: 'Lumière tamisée',
    });
    expect(plain(card?.shoot ?? '')).toBe('2 photos, 1 vidéo de 1 à 2 min');
    expect(card?.hints).toEqual(['01 · Assise, jambes croisées', '03 · Face caméra <chuchote> & sourit']);
  });

  it('gives a variant its own card, and nothing for a letter the stage does not have', () => {
    expect(cardContent(version, 'canape', { theme: 'day', variant: 'B' })).toMatchObject({
      kicker: 'Étape 1 · Variante B',
      moment: 'Jour',
      lines: ['Elle se dévoile doucement', 'Robe rouge'],
    });
    expect(cardContent(version, 'canape', { theme: 'day', variant: 'C' })).toBeNull();
    expect(cardContent(version, 'lit', { theme: 'day', variant: 'A' })).toBeNull();
  });

  it('names the two stages of a bridge by their numbers and names', () => {
    expect(cardContent(version, 'canape-lit', { theme: 'night' })).toMatchObject({
      kicker: 'Pont · Étape 1 → Étape 2',
      title: 'On passe à côté ?',
      lines: ['Entre « Canapé » et « Lit »'],
      shoot: '',
    });
    expect(cardContent(version, 'absente', { theme: 'night' })).toBeNull();
  });
});

describe('cardSvg', () => {
  const card = cardContent(version, 'canape', { theme: 'night', variant: 'A' });
  if (card === null) throw new Error('no card');

  it('gives the same SVG for the same input, in each format', async () => {
    const svg = cardSvg(card, 'night', 'folder');
    expect(cardSvg(card, 'night', 'folder')).toBe(svg);
    await expect(svg).toMatchFileSnapshot('./__snapshots__/card-night-folder.svg');
    expect(cardSvg(card, 'night', 'thumbnail')).toContain('width="320" height="320" viewBox="0 0 1080 1080"');
  });

  it('keeps three hints at least on a full card, and never says « + N » alone (Extension’s review)', () => {
    const full: ScriptStructureVersion = {
      ...version,
      segments: [
        {
          kind: 'stage',
          key: 'plein',
          name: 'Un titre assez long pour deux lignes',
          intention:
            'Une intention longue qui prendrait volontiers deux lignes entières sur le carton du dossier',
          mood: 'Lumière tamisée, bougies',
          mediaSlots: [
            { kind: 'image', optional: false, hint: 'Assise, jambes croisées' },
            { kind: 'image', optional: false, hint: 'De dos' },
            { kind: 'image', optional: false, hint: 'Gros plan' },
            { kind: 'video', optional: false, hint: 'Face caméra', minSeconds: 45, maxSeconds: 90 },
            { kind: 'audio', optional: true, hint: 'Un vocal', maxSeconds: 30 },
          ],
          variants: [{ letter: 'B', hint: 'Robe rouge, talons hauts et collier de perles assorti au rouge' }],
        },
      ],
    };
    const content = cardContent(full, 'plein', { theme: 'night', variant: 'B' });
    if (content === null) throw new Error('no card');
    const svg = plain(cardSvg(content, 'night', 'folder'));
    for (const hint of ['01 · Assise, jambes croisées', '02 · De dos', '03 · Gros plan'])
      expect(svg).toContain(hint);
    expect(svg).toContain('+ 2 indications');
    expect(svg).not.toMatch(/>\+ \d+<\/text>/u);
  });

  it('gives the chatters a thumbnail of the stage, its title and what to shoot only', () => {
    const svg = cardSvg(card, 'night', 'thumbnail');
    expect(svg).toContain('>Canapé</text>');
    expect(svg).toContain('ÉTAPE 1 · VARIANTE A');
    expect(svg).not.toContain('Soirée au salon');
    expect(svg).not.toContain('Assise');
  });

  it('escapes what the agency wrote, and names no file, image nor link', () => {
    const svg = cardSvg(card, 'day', 'card');
    expect(svg).toContain('Face caméra &lt;chuchote&gt; &amp; sourit');
    expect(svg).not.toMatch(/<image|href=|url\(|@import|<script/iu);
  });
});

describe('CARD_PALETTES', () => {
  /** The design system's tokens, read from its stylesheet: a card never drifts from the app. */
  const tokens = readFileSync(
    fileURLToPath(
      new URL('../../../../../../../packages/design-system/src/styles/tokens.css', import.meta.url),
    ),
    'utf8',
  );
  const block = (selector: string): string => {
    const start = tokens.indexOf(`${selector} {`);
    return tokens.slice(start, tokens.indexOf('\n}', start));
  };
  const token = (css: string, name: string): string | undefined =>
    new RegExp(`--nv-${name}:\\s*(#[0-9a-f]{6})`, 'u').exec(css)?.[1];

  it('takes its colours from tokens.css, Nuit from the dark theme and Jour from the light one', () => {
    for (const [theme, selector] of [
      ['night', "[data-theme='dark']"],
      ['day', "[data-theme='light']"],
    ] as const) {
      const css = block(selector);
      const palette = CARD_PALETTES[theme];
      expect([
        palette.background,
        palette.surface,
        palette.ink,
        palette.muted,
        palette.accent,
        palette.accentInk,
      ]).toEqual(
        ['void', 'surface-raised', 'ink', 'ink-muted', 'neon', 'neon-ink'].map((name) => token(css, name)),
      );
    }
  });
});
