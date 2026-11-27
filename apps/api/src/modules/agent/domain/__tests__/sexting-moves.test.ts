import { describe, expect, it } from 'vitest';

import {
  cameBeforeFinale,
  haggles,
  insistsForMore,
  mentionsOtherWoman,
  isBareMurmur,
  peakSeen,
  peakStepIndex,
  wantsOtherMan,
} from '../sexting-moves';

const AT = new Date('2026-11-26T21:00:00Z');
const step = (intensities?: string[]) => ({
  stepRef: 'ref',
  kind: 'paid' as const,
  priceMinor: 1000,
  mediaRefs: [],
  ...(intensities !== undefined && { carries: { intensities } }),
});
const sent = (
  stepIndex: number,
  kind: 'free' | 'paid',
  outcome: 'sent' | 'opened' | 'bought' | 'refused',
) => ({
  stepIndex,
  kind,
  outcome,
  priceMinor: null,
  sentAt: AT,
  at: AT,
});

describe('the frankest step of her script (Charles 26/11)', () => {
  it('is the step with the frankest tags, the last on a tie, else the last step', () => {
    expect(peakStepIndex({ steps: [step(['soft']), step(['hardcore']), step(['explicit'])] })).toBe(1);
    expect(peakStepIndex({ steps: [step(['explicit']), step(['explicit'])] })).toBe(1);
    expect(peakStepIndex({ steps: [step(), step(), step()] })).toBe(2);
    expect(peakStepIndex({ steps: [] })).toBeUndefined();
  });

  it('is seen once sent free, or bought or opened; not while paid and locked', () => {
    const script = { steps: [step(['soft']), step(['hardcore']), step(['explicit'])] };
    expect(peakSeen({ steps: [sent(0, 'free', 'sent')] }, script)).toBe(false);
    expect(peakSeen({ steps: [sent(1, 'paid', 'sent')] }, script)).toBe(false);
    expect(peakSeen({ steps: [sent(1, 'paid', 'bought')] }, script)).toBe(true);
    expect(peakSeen({ steps: [sent(1, 'free', 'sent')] }, script)).toBe(true);
    expect(peakSeen({ steps: [sent(1, 'paid', 'bought')] }, undefined)).toBe(false);
  });
});

describe('the moments of the sexting (Charles 26/11)', () => {
  it('he came before the end: his run was still open', () => {
    expect(cameBeforeFinale({ status: 'open' })).toBe(true);
    expect(cameBeforeFinale({ status: 'bought_out' })).toBe(false);
    expect(cameBeforeFinale(null)).toBe(false);
  });

  it('a bare murmur, nothing said', () => {
    for (const murmur of ['mmh', 'Mmmh…', 'hmm', 'oh', 'humm 🥵'])
      expect(isBareMurmur(murmur), murmur).toBe(true);
    for (const said of ['mmh j’adore', 'oh oui continue', 'ok', 'merci'])
      expect(isBareMurmur(said), said).toBe(false);
  });

  it('he haggles or asks for it free', () => {
    expect(haggles('price_objection', 'trop cher')).toBe(true);
    expect(haggles('sexting', 'tu me la fais gratuite ?')).toBe(true);
    expect(haggles('sexting', 'send it for free')).toBe(true);
    expect(haggles('sexting', 'continue, j’adore')).toBe(false);
  });

  it('another man only when a fantasy of his card asks for one', () => {
    expect(wantsOtherMan({ desires: ['candaulisme'] })).toBe(true);
    expect(wantsOtherMan({ desires: ['la regarder avec un autre'] })).toBe(true);
    expect(wantsOtherMan({ desires: ['lingerie noire'] })).toBe(false);
  });

  it('he insists for something more after a disappointing media', () => {
    expect(insistsForMore('bof, tu m’en envoies une autre ?')).toBe(true);
    expect(insistsForMore('il faut compenser là')).toBe(true);
    expect(insistsForMore('je m’attendais à mieux')).toBe(false);
  });

  it('he speaks of another woman', () => {
    expect(mentionsOtherWoman('ma copine dort à côté')).toBe(true);
    expect(mentionsOtherWoman('je parle à d’autres créatrices aussi')).toBe(true);
    expect(mentionsOtherWoman('my wife is away')).toBe(true);
    expect(mentionsOtherWoman('ma mère m’a appelé')).toBe(false);
    expect(mentionsOtherWoman('t’es la plus belle')).toBe(false);
  });
});
