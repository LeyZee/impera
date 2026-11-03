import {
  ScriptStructureVersionIdSchema,
  newId,
  SCRIPT_CARD_INKS,
  type MediaSlot,
  type ScriptStructureVersion,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { cardContent, cardSvg, duration, quoteLines, shootSummary, wrap } from '../cards';

const NBSP = ' ';
const plain = (text: string): string => text.replaceAll(NBSP, ' ');

/** An invented structure: never a real one of the agency in the repository (SC-01). */
const version: ScriptStructureVersion = {
  id: newId(ScriptStructureVersionIdSchema),
  version: 1,
  name: 'Soirée au salon',
  moment: 'night',
  color: { primary: '#5c1029', secondary: '#911e42', accent: '#b03a78' },
  frozen: false,
  updatedAt: '2026-11-03T10:00:00.000Z',
  segments: [
    {
      kind: 'stage',
      key: 'canape',
      name: 'Canapé',
      intention: 'Elle se dévoile doucement',
      access: 'paid',
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
    {
      kind: 'bridge',
      key: 'canape-lit',
      from: 'canape',
      to: 'lit',
      teaser: 'On passe à côté ?',
      mediaSlots: [{ kind: 'image', optional: false, hint: null }],
    },
    {
      kind: 'stage',
      key: 'lit',
      name: 'Lit',
      intention: 'Plus près',
      access: 'free',
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
  it('says a stage’s number and name, what it sells, offered or paid, what to shoot and its series', () => {
    const card = cardContent(version, 'canape');
    expect(card).toMatchObject({
      kind: 'stage',
      title: 'ÉTAPE 1',
      subtitle: 'Canapé',
      quote: 'Elle se dévoile doucement',
      access: 'PAYANT',
      moment: 'NUIT',
      mood: 'Lumière tamisée',
      series: ['Série A', 'Série B'],
    });
    expect(plain(card?.shoot ?? '')).toBe('2 photos, 1 vidéo de 1 à 2 min, par série');
    expect(card?.hints).toEqual(['01 · Assise, jambes croisées', '03 · Face caméra <chuchote> & sourit']);
    expect(cardContent(version, 'lit')).toMatchObject({ title: 'ÉTAPE 2', access: 'GRATUIT', series: [] });
  });

  it('gives a variant its series card, and nothing for a letter the stage does not have', () => {
    expect(cardContent(version, 'canape', { variant: 'B' })).toMatchObject({
      kind: 'series',
      title: 'ÉTAPE 1',
      subtitle: 'Série B',
      quote: 'Robe rouge',
    });
    expect(cardContent(version, 'canape', { variant: 'C' })).toBeNull();
    expect(cardContent(version, 'lit', { variant: 'A' })).toBeNull();
  });

  it('names a bridge by its two stages, always offered, with its teaser photo', () => {
    const card = cardContent(version, 'canape-lit');
    expect(card).toMatchObject({
      kind: 'bridge',
      title: 'PONT 1 & 2',
      quote: 'On passe à côté ?',
      access: 'GRATUIT',
    });
    expect(plain(card?.shoot ?? '')).toBe('1 photo');
    expect(cardContent(version, 'canape-lit', { variant: 'A' })).toBeNull();
    expect(cardContent(version, 'absente')).toBeNull();
  });
});

describe('cardSvg', () => {
  const card = cardContent(version, 'canape');
  if (card === null) throw new Error('no card');

  it('gives the same SVG for the same input, in each format', async () => {
    const svg = cardSvg(card, 'folder');
    expect(cardSvg(card, 'folder')).toBe(svg);
    await expect(svg).toMatchFileSnapshot('./__snapshots__/card-stage-folder.svg');
    expect(cardSvg(card, 'thumbnail')).toContain('width="320" height="320" viewBox="0 0 1080 1080"');
  });

  it('fills the card with the script’s colour, written in the ink that reads on it (ADR 0064)', () => {
    const svg = cardSvg(card, 'card');
    for (const tone of ['#5c1029', '#911e42', '#b03a78']) expect(svg).toContain(`stop-color="${tone}"`);
    expect(svg).toContain(`fill="${SCRIPT_CARD_INKS.light}"`);
    const pale = cardContent(
      { ...version, color: { primary: '#ffcad4', secondary: '#c7ceea', accent: '#b5ead7' } },
      'lit',
    );
    if (pale === null) throw new Error('no card');
    expect(cardSvg(pale, 'card')).toContain(`fill="${SCRIPT_CARD_INKS.dark}"`);
  });

  it('writes the series at the foot of a stage, an arch for a bridge, an arrow for a series', () => {
    const stage = cardSvg(card, 'card');
    expect(stage).toContain('>Série A</text>');
    expect(stage).toContain('>Série B</text>');
    expect(stage).toContain('(PAYANT)');
    const bridge = cardContent(version, 'canape-lit');
    const series = cardContent(version, 'canape', { variant: 'A' });
    if (bridge === null || series === null) throw new Error('no card');
    expect(cardSvg(bridge, 'card')).toMatch(/<path d="M 290 990 A/u);
    expect(cardSvg(bridge, 'card')).toContain('(GRATUIT)');
    expect(cardSvg(series, 'card')).toMatch(/<path d="M 380 900/u);
  });

  it('keeps three hints at least on a full card, and never says « + N » alone (Extension’s review)', () => {
    const full: ScriptStructureVersion = {
      ...version,
      segments: [
        {
          kind: 'stage',
          key: 'plein',
          name: 'Un nom d’étape assez long pour deux lignes',
          intention:
            'Une intention longue qui prendrait volontiers trois lignes entières sur le carton du dossier, voire plus',
          access: 'paid',
          mood: 'Lumière tamisée, bougies',
          mediaSlots: [
            { kind: 'image', optional: false, hint: 'Assise, jambes croisées' },
            { kind: 'image', optional: false, hint: 'De dos' },
            { kind: 'image', optional: false, hint: 'Gros plan' },
            { kind: 'video', optional: false, hint: 'Face caméra', minSeconds: 45, maxSeconds: 90 },
            { kind: 'audio', optional: true, hint: 'Un vocal', maxSeconds: 30 },
          ],
          variants: [
            { letter: 'A', hint: 'Robe noire' },
            { letter: 'B', hint: 'Robe rouge' },
            { letter: 'C', hint: 'Lingerie' },
          ],
        },
      ],
    };
    const content = cardContent(full, 'plein');
    if (content === null) throw new Error('no card');
    const svg = plain(cardSvg(content, 'folder'));
    for (const hint of ['01 · Assise, jambes croisées', '02 · De dos', '03 · Gros plan'])
      expect(svg).toContain(hint);
    expect(svg).toContain('+ 2 indications');
    expect(svg).not.toMatch(/>\+ \d+<\/text>/u); // A cut quote keeps its tag, and the text is drawn in the full ink (Extension's review).
    expect(svg).toMatch(/… » \(PAYANT\)<\/text>/u);
    expect(svg).not.toMatch(/<text[^>]*fill-opacity/u);
  });

  it('holds the quote marks to their words, and keeps the tag when the quote is cut', () => {
    expect(quoteLines('Elle se dévoile', 'GRATUIT', 40, 2)).toEqual([
      `«${NBSP}Elle se dévoile${NBSP}» (GRATUIT)`,
    ]);
    const cut = quoteLines('un deux trois quatre cinq six sept huit neuf dix onze douze', 'PAYANT', 20, 2);
    expect(cut).toHaveLength(2);
    expect(cut[1]).toMatch(/…\u00a0» \(PAYANT\)$/u);
    for (const line of cut) expect(line.length).toBeLessThanOrEqual(20);
    expect(quoteLines('Robe noire', null, 40, 1)).toEqual([`«${NBSP}Robe noire${NBSP}»`]);
  });

  it('gives the chatters a thumbnail of the stage, its name and what to shoot only', () => {
    const svg = cardSvg(card, 'thumbnail');
    expect(svg).toContain('>Canapé</text>');
    expect(svg).toContain('>ÉTAPE 1</text>');
    expect(svg).toContain('>(PAYANT)</text>');
    expect(svg).not.toContain('Soirée au salon');
    expect(svg).not.toContain('Assise');
  });

  it('escapes what the agency wrote, and names no file, image nor link', () => {
    const svg = cardSvg(card, 'card');
    expect(svg).toContain('Face caméra &lt;chuchote&gt; &amp; sourit');
    expect(svg).not.toMatch(/<image|href=|@import|<script/iu);
  });
});
