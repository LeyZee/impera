import type { DropMediaDescription } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { pointsElsewhere, reviewReasonsOf } from '../drop-review';

/** An invented media (ADR 0010): described alone, she alone, nothing to hold back. */
const ALONE: DropMediaDescription = {
  vocabularyVersion: '1.0.0',
  kind: 'image',
  detailed:
    'Selfie dans un miroir de salle de bain, lumière du jour. Cheveux bruns longs et lâchés, robe rouge en satin à fines bretelles, collier doré. Elle tient le téléphone de la main droite et sourit à l’objectif.',
  factualDescription: 'Selfie au miroir en robe rouge, salle de bain éclairée par le jour.',
  durationS: null,
  segments: [],
  intensity: 'soft',
  anatomyVisible: [],
  castMode: 'solo',
  mood: [],
  setting: 'salle de bain, lumière du jour, robe rouge',
  audio: null,
  textVisible: null,
  quality: 'good',
  confidenceLow: false,
  notVisible: false,
  flags: [],
};

describe('a description of her drop (ADR 0083 § 3 to 5)', () => {
  it('holds nothing back when it is alone, about her alone', () => {
    expect(pointsElsewhere(ALONE)).toBe(false);
    expect(reviewReasonsOf(ALONE)).toEqual([]);
  });

  it.each([
    'Elle porte à nouveau la robe rouge.',
    'Elle est de nouveau devant le miroir.',
    'Elle porte la même robe.',
    'Le même décor, une chambre.',
    'Elle est toujours dans la salle de bain.',
    'Comme sur la photo précédente, elle sourit.',
    'Même pose que précédemment, comme avant.',
    'ELLE REPREND ENCORE LA POSE.',
  ])('sees a pointer to another media in « %s »', (sentence) => {
    expect(pointsElsewhere({ ...ALONE, detailed: sentence })).toBe(true);
    expect(reviewReasonsOf({ ...ALONE, detailed: sentence })).toEqual(['back_reference']);
  });

  it('reads the summary and every segment, not only the long text', () => {
    expect(pointsElsewhere({ ...ALONE, factualDescription: 'Encore un selfie.' })).toBe(true);
    const segment = { startS: 0, endS: 10, description: 'Elle danse toujours.' };
    expect(pointsElsewhere({ ...ALONE, segments: [segment] })).toBe(true);
  });

  it('leaves her own quoted words alone: « encore » in her mouth points to nothing', () => {
    expect(
      pointsElsewhere({ ...ALONE, detailed: 'Elle rit et dit « encore une fois ! » face caméra.' }),
    ).toBe(false);
    expect(pointsElsewhere({ ...ALONE, detailed: 'Elle chuchote "toujours plus" en souriant.' })).toBe(false);
  });

  it('does not mistake a word that only contains a pointer', () => {
    expect(
      pointsElsewhere({ ...ALONE, detailed: 'Une encoche dans le bois du lit, des mèmes au mur.' }),
    ).toBe(false);
  });

  it('holds back another person, whatever the model is sure of (§ 4)', () => {
    expect(reviewReasonsOf({ ...ALONE, castMode: 'duo' })).toEqual(['not_alone']);
    expect(reviewReasonsOf({ ...ALONE, castMode: 'group' })).toEqual(['not_alone']);
    expect(reviewReasonsOf({ ...ALONE, flags: ['identifiable_third_party'] })).toEqual(['not_alone']);
    expect(reviewReasonsOf({ ...ALONE, castMode: 'not_visible' })).toEqual([]);
  });

  it('holds back a doubt of the model, and any other flag (§ 5)', () => {
    expect(reviewReasonsOf({ ...ALONE, confidenceLow: true })).toEqual(['unsure']);
    expect(reviewReasonsOf({ ...ALONE, notVisible: true })).toEqual(['unsure']);
    expect(reviewReasonsOf({ ...ALONE, flags: ['possible_minor'] })).toEqual(['flagged']);
    expect(
      reviewReasonsOf({
        ...ALONE,
        detailed: 'À nouveau seule.',
        castMode: 'duo',
        confidenceLow: true,
        flags: ['drugs'],
      }),
    ).toEqual(['back_reference', 'not_alone', 'unsure', 'flagged']);
  });
});
