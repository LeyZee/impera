import { describe, expect, it } from 'vitest';

import {
  aboutTen,
  ageBandOf,
  countOf,
  ageOf,
  jobFamilyOf,
  placeOf,
  rank,
  sharesOf,
  situationOf,
} from '../figures';

// Every value below is invented (ADR 0010: the repository is public).

describe('ageOf (ADR 0074 § 3)', () => {
  it.each([
    ['28', 28],
    ["j'ai 28 ans", 28],
    ['28 ANS', 28],
    ['vingt-huit ans', 28],
    ['dix-huit', 18],
    ['vingt et un ans', 21],
    ['trente deux', 32],
    ['soixante-douze', 72],
    ['soixante-dix-sept ans', 77],
    ['quatre-vingt-dix-neuf', 99],
    ['quarante ans tout pile', 40],
  ])('reads %s as %i', (value, age) => {
    expect(ageOf(value)).toBe(age);
  });

  it.each(['entre 30 et 35', 'la trentaine', 'environ 40', '17 ans', '120', 'jeune', '', '30 ou 31'])(
    'reads nothing in « %s »',
    (value) => {
      expect(ageOf(value)).toBeNull();
    },
  );

  it('bands an age as ADR 0065 § 3', () => {
    expect([18, 24, 25, 34, 35, 44, 45, 54, 55, 99].map(ageBandOf)).toEqual([
      '18_24',
      '18_24',
      '25_34',
      '25_34',
      '35_44',
      '35_44',
      '45_54',
      '45_54',
      '55_plus',
      '55_plus',
    ]);
  });
});

describe('placeOf (ADR 0074 § 4)', () => {
  it.each([
    ['Lyon', 'auvergne_rhone_alpes'],
    ['lyon', 'auvergne_rhone_alpes'],
    ['Villeurbanne', 'auvergne_rhone_alpes'],
    ['vers Annecy', 'auvergne_rhone_alpes'],
    ['région lyonnaise', 'auvergne_rhone_alpes'],
    ['Saint-Étienne', 'auvergne_rhone_alpes'],
    ['Paris 15e', 'ile_de_france'],
    ['banlieue parisienne', 'ile_de_france'],
    ['Marseille', 'provence_alpes_cote_d_azur'],
    ['Bouches-du-Rhône', 'provence_alpes_cote_d_azur'],
    ['Aix-les-Bains', 'auvergne_rhone_alpes'],
    ['Pays de la Loire', 'pays_de_la_loire'],
    ['Saône-et-Loire', 'bourgogne_franche_comte'],
    ['Lot-et-Garonne', 'nouvelle_aquitaine'],
    ['Eure-et-Loir', 'centre_val_de_loire'],
    ['Haute-Vienne', 'nouvelle_aquitaine'],
    ['dans le 69', 'auvergne_rhone_alpes'],
    ['33000', 'nouvelle_aquitaine'],
    ['2A', 'corse'],
    ['la Réunion', 'outre_mer'],
    ['97400', 'outre_mer'],
    ['Bruxelles', 'belgium'],
    ['Genève', 'switzerland'],
    ['je suis belge', 'belgium'],
    ['Montréal', 'canada'],
  ])('ranks %s in %s', (value, place) => {
    expect(placeOf(value)).toBe(place);
  });

  it('never keeps a city: an unknown place is « Autres »', () => {
    expect(placeOf('un petit village')).toBeNull();
    expect(placeOf('France')).toBeNull();
    expect(placeOf('Tokyo')).toBeNull();
  });
});

describe('jobFamilyOf (ADR 0074 § 5)', () => {
  it.each([
    ['infirmier', 'health'],
    ['infirmière de nuit', 'health'],
    ['aide-soignante', 'health'],
    ['prof de maths', 'teaching'],
    ['dans l’info', 'engineering'],
    ['développeur web', 'engineering'],
    ['ingénieur', 'engineering'],
    ['commercial', 'sales'],
    ['caissière', 'sales'],
    ['comptable', 'office'],
    ['avocat', 'office'],
    ['maçon', 'building'],
    ['électricien', 'building'],
    ['plombier à son compte', 'building'],
    ['chauffeur poids lourd', 'transport'],
    ['cariste', 'transport'],
    ['cuisinier', 'hospitality'],
    ['serveur', 'hospitality'],
    ['militaire', 'security'],
    ['pompier volontaire', 'security'],
    ['agriculteur', 'agriculture'],
    ['photographe', 'arts'],
    ['auto-entrepreneur', 'self_employed'],
    ['chef d’entreprise', 'self_employed'],
    ['étudiant en médecine', 'student'],
    ['en alternance', 'student'],
    ['retraité de l’armée', 'retired'],
    ['à la retraite', 'retired'],
  ])('ranks %s in %s', (value, family) => {
    expect(jobFamilyOf(value)).toBe(family);
  });

  it('puts out of work and the unknown in « Autres »', () => {
    expect(jobFamilyOf('au chômage')).toBeNull();
    expect(jobFamilyOf('ancien militaire au chômage')).toBeNull();
    expect(jobFamilyOf('sans emploi')).toBeNull();
    expect(jobFamilyOf('je fais des trucs')).toBeNull();
  });
});

describe('situationOf (ADR 0074 § 6)', () => {
  it.each([
    ['célibataire', 'single'],
    ['celib', 'single'],
    ['pas en couple', 'single'],
    ['en couple', 'couple'],
    ['pacsé', 'couple'],
    ['marié', 'married'],
    ['mariée depuis 10 ans', 'married'],
    ['divorcé', 'separated'],
    ['séparé, deux enfants', 'separated'],
  ])('ranks %s in %s', (value, situation) => {
    expect(situationOf(value)).toBe(situation);
  });

  it('puts the rest in « Autres »', () => {
    expect(situationOf("c'est compliqué")).toBeNull();
    expect(situationOf('veuf')).toBeNull();
  });
});

describe('shares (ADR 0074 § 8)', () => {
  it('rounds the total to ten', () => {
    expect([0, 4, 5, 14, 15, 42, 310].map(aboutTen)).toEqual([0, 0, 10, 10, 20, 40, 310]);
  });

  it('rounds a count of fans to ten and gives nothing under ten', () => {
    expect([0, 9, 10, 14, 15, 312].map(countOf)).toEqual([null, null, 10, 10, 20, 310]);
  });

  it('gives whole shares that sum to 100', () => {
    expect(sharesOf([1, 1, 1])).toEqual([34, 33, 33]);
    expect(sharesOf([2, 1])).toEqual([67, 33]);
    expect(sharesOf([0, 0])).toEqual([0, 0]);
    expect(sharesOf([7, 13, 22]).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('shows nothing under 10 fans', () => {
    expect(rank(Array.from({ length: 9 }, () => 'health'))).toEqual({ status: 'too_few' });
  });

  it('moves a case under 3 fans to « Autres », and keeps no count', () => {
    const cases = [...Array<'health'>(6).fill('health'), 'arts', 'arts', null, null] as const;
    expect(rank(cases)).toEqual({
      status: 'enough',
      aboutFans: 10,
      cases: [
        { key: 'health', share: 60 },
        { key: 'other', share: 40 },
      ],
    });
  });

  it('keeps the five most cited, the rest in « Autres »', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
    const cases = keys.flatMap((key, i) => Array<string>(8 - i).fill(key));
    const ranked = rank(cases, { top: 5 });
    if (ranked.status !== 'enough') throw new Error('expected figures');
    expect(ranked.cases.map((c) => c.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'other']);
    expect(ranked.cases.reduce((sum, c) => sum + c.share, 0)).toBe(100);
  });

  it('keeps fixed cases in their order', () => {
    const cases = [...Array<string>(5).fill('35_44'), ...Array<string>(5).fill('18_24')];
    const ranked = rank(cases, { order: ['18_24', '25_34', '35_44'] });
    if (ranked.status !== 'enough') throw new Error('expected figures');
    expect(ranked.cases.map((c) => c.key)).toEqual(['18_24', '35_44']);
  });
});
