import { describe, expect, it } from 'vitest';

import {
  contentWords,
  desireMapOf,
  EMPTY_DESIRE_MAP,
  fantasyMatchOf,
  rankByFantasy,
  withoutHerLimits,
  type DesireMap,
  type ScriptTextView,
} from '../fantasy-match';
import { touchesTerm } from '../guards';

const script = (ref: string, description: string, extra: Partial<ScriptTextView> = {}) => ({
  ref,
  description,
  steps: [],
  ...extra,
});

const map = (part: Partial<DesireMap>): DesireMap => ({ ...EMPTY_DESIRE_MAP, ...part });

describe('his desire map, read from his notes (Charles 26/11)', () => {
  it('reads the five fields of the card, list items split, other lines ignored', () => {
    const notes = [
      'first_name : Hugo',
      'desires : qu’elle prenne les devants · jeu de rôle au bureau',
      'outfits : lingerie noire',
      'words_that_work : mon grand',
      'limits : la douleur',
      'cools_him : trop de vulgarité',
      'Note : relancer jeudi',
    ].join('\n');
    expect(desireMapOf(notes)).toEqual({
      desires: ['qu’elle prenne les devants', 'jeu de rôle au bureau'],
      outfits: ['lingerie noire'],
      wordsThatWork: ['mon grand'],
      limits: ['la douleur'],
      coolsHim: ['trop de vulgarité'],
    });
    expect(desireMapOf('')).toEqual(EMPTY_DESIRE_MAP);
  });
});

describe('the script closest to his fantasy', () => {
  it('reads accents, case and plurals alike', () => {
    expect([...contentWords('Bas NOIRS, talons')]).toEqual([...contentWords('un bas noir et des talons')]);
    expect(contentWords('Lingerie noire').has('noir')).toBe(true);
    expect(contentWords('Écolière').has('ecolier')).toBe(true);
  });

  it('orders the scripts that meet his fantasies first, naming what they share', () => {
    const scripts = [
      script('a', 'Un moment tendre au réveil, en pyjama'),
      script('b', 'Elle se prépare en lingerie noire et bas, puis le provoque'),
      script('c', 'Une douche après le sport'),
    ];
    const { ranked, uncovered } = rankByFantasy(
      scripts,
      map({ outfits: ['bas noirs', 'lingerie'], desires: ['qu’elle le provoque'] }),
    );
    expect(ranked.map((one) => one.script.ref)).toEqual(['b', 'a', 'c']);
    expect(ranked[0]?.matches).toEqual(['qu’elle le provoque', 'bas noirs', 'lingerie']);
    expect(ranked[1]?.matches).toEqual([]);
    expect(uncovered).toEqual([]);
  });

  it('keeps the agency’s order when nothing meets him', () => {
    const scripts = [script('a', 'Au réveil'), script('b', 'Le soir')];
    const { ranked, uncovered } = rankByFantasy(scripts, map({ desires: ['jeu de rôle au bureau'] }));
    expect(ranked.map((one) => one.script.ref)).toEqual(['a', 'b']);
    expect(ranked.every((one) => one.score === 0 && one.matches.length === 0)).toBe(true);
    expect(uncovered).toEqual(['jeu de rôle au bureau']);
  });

  it('never offers a script that touches one of his limits', () => {
    const scripts = [script('a', 'Elle joue avec des menottes'), script('b', 'Elle se déshabille lentement')];
    const { ranked } = rankByFantasy(scripts, map({ limits: ['les menottes'], desires: ['menottes'] }));
    expect(ranked.map((one) => one.script.ref)).toEqual(['b']);
    expect(fantasyMatchOf(scripts[0] ?? script('x', ''), map({ limits: ['menottes'] }))).toBeNull();
  });

  it('puts behind a script that has what cools him', () => {
    const scripts = [script('a', 'Elle lui parle très crûment'), script('b', 'Elle lui murmure doucement')];
    const { ranked } = rankByFantasy(scripts, map({ coolsHim: ['parle crûment'] }));
    expect(ranked.map((one) => one.script.ref)).toEqual(['b', 'a']);
  });

  it('weighs the words that work on him less than a fantasy', () => {
    const scripts = [script('a', 'Elle l’appelle mon grand'), script('b', 'Elle prend les devants')];
    const { ranked } = rankByFantasy(
      scripts,
      map({ desires: ['les devants'], wordsThatWork: ['mon grand'] }),
    );
    expect(ranked.map((one) => [one.script.ref, one.score])).toEqual([
      ['b', 1],
      ['a', 0.5],
    ]);
    expect(ranked[1]?.matches).toEqual(['mon grand']);
  });

  it('reads what a script carries in the closed vocabulary first, and its media sheets', () => {
    const carried = script('a', 'Un moment à elle', {
      carriesAll: {
        outfitStyles: ['lingerie'],
        outfitPieces: [{ type: 'stockings', colours: ['black'] }],
        moods: ['dominant'],
      },
    });
    const sheet = script('b', 'Un moment à elle', { steps: [{ mediaSheet: 'Elle porte une robe rouge' }] });
    const outfits = map({ outfits: ['des bas noirs'], desires: ['qu’elle le domine'] });
    expect(fantasyMatchOf(carried, outfits)?.matches).toEqual(['qu’elle le domine', 'des bas noirs']);
    expect(fantasyMatchOf(sheet, map({ outfits: ['robe rouge'] }))?.matches).toEqual(['robe rouge']);
  });

  it('matches an adult fantasy he brings like any other, by its words only', () => {
    const scripts = [
      script('a', 'Elle le supplie de jouir en elle, de lui faire un bébé'),
      script('b', 'Au réveil'),
    ];
    const { ranked, uncovered } = rankByFantasy(scripts, map({ desires: ['lui faire un bébé'] }));
    expect(ranked[0]?.script.ref).toBe('a');
    expect(ranked[0]?.matches).toEqual(['lui faire un bébé']);
    expect(uncovered).toEqual([]);
  });
});

describe('what her persona refuses wins over his fantasy (Charles 26/11 at 21:22)', () => {
  it('drops a fantasy, an outfit or a word that touches her disgusts: neither played nor a script’s target', () => {
    const refusals = ['cuir', 'au bureau'];
    const his = map({
      desires: ['jeu de rôle au bureau', 'qu’elle prenne les devants'],
      outfits: ['tenue en cuir', 'lingerie noire'],
      wordsThatWork: ['mon grand'],
      limits: ['la douleur'],
    });
    const kept = withoutHerLimits(his, (item) => refusals.some((term) => touchesTerm(item, term)));
    expect(kept).toEqual({
      ...his,
      desires: ['qu’elle prenne les devants'],
      outfits: ['lingerie noire'],
    });
    const { ranked, uncovered } = rankByFantasy([script('a', 'Elle joue au bureau, tenue en cuir')], kept);
    expect(ranked[0]?.matches).toEqual([]);
    expect(uncovered).toEqual(['qu’elle prenne les devants']);
  });
});
