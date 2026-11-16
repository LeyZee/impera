import { describe, expect, it } from 'vitest';

import { declaredAdultAge, sexualizationDecision, type SexualizationContext } from '../sexualization';

const base: SexualizationContext = {
  relationshipHours: 48,
  ageConfirmed: true,
  noExplicit: false,
  fanSexualizes: true,
  desire: 50,
  limits: { initiateAfterHours: 36, minHoursBeforeFollowing: 2, minDesireToOpen: 40 },
};

describe('sexualizationDecision', () => {
  it('follows a confirmed adult past the KYC minimum', () => {
    expect(sexualizationDecision({ ...base, relationshipHours: 3 })).toEqual({ kind: 'free' });
  });

  it('steers him back before his age is confirmed, whatever the time', () => {
    expect(sexualizationDecision({ ...base, ageConfirmed: false })).toEqual({
      kind: 'steer_back',
      reason: 'age_unconfirmed',
    });
  });

  it('steers him back before the KYC minimum', () => {
    expect(sexualizationDecision({ ...base, relationshipHours: 1 })).toEqual({
      kind: 'steer_back',
      reason: 'too_early',
    });
  });

  it('opens it herself only after her delay, and never with his age unknown', () => {
    const calm = { ...base, fanSexualizes: false };
    expect(sexualizationDecision({ ...calm, relationshipHours: 20 })).toEqual({ kind: 'no_opening' });
    expect(sexualizationDecision(calm)).toEqual({ kind: 'free' });
    expect(sexualizationDecision({ ...calm, ageConfirmed: false })).toEqual({ kind: 'no_opening' });
  });

  it('opens it herself only once he is warm enough, and follows him whatever his score (P3-12)', () => {
    const calm = { ...base, fanSexualizes: false };
    expect(sexualizationDecision({ ...calm, desire: 39 })).toEqual({ kind: 'no_opening' });
    expect(sexualizationDecision({ ...calm, desire: 40 })).toEqual({ kind: 'free' });
    expect(sexualizationDecision({ ...base, desire: 0 })).toEqual({ kind: 'free' });
  });

  it('stays suggestive with a fan a human set to nothing explicit, and never opens it herself', () => {
    expect(sexualizationDecision({ ...base, noExplicit: true })).toEqual({ kind: 'suggestive_only' });
    expect(sexualizationDecision({ ...base, noExplicit: true, fanSexualizes: false })).toEqual({
      kind: 'no_opening',
    });
  });
});

describe('declaredAdultAge', () => {
  const fact = (value: string, kind = 'declared', confidence = 0.9) => [
    { key: 'age', value, kind, confidence },
  ];

  it('reads an adult age he wrote himself', () => {
    expect(declaredAdultAge(fact('27 ans'), 'Moi j’ai 27 ans et toi')).toBe(27);
    expect(declaredAdultAge(fact('18'), '18')).toBe(18);
  });

  it('never on the brain’s word alone, a guess, a doubt or a second number', () => {
    expect(declaredAdultAge(fact('27'), 'Devine')).toBeNull();
    expect(declaredAdultAge(fact('27', 'inferred'), 'J’ai 27 ans')).toBeNull();
    expect(declaredAdultAge(fact('27', 'declared', 0.5), 'J’ai 27 ans')).toBeNull();
    expect(declaredAdultAge(fact('entre 25 et 30'), 'Entre 25 et 30')).toBeNull();
    expect(declaredAdultAge(fact('127'), 'J’ai 127 ans')).toBeNull();
  });

  it('never with an age under 18 anywhere in his message', () => {
    expect(declaredAdultAge(fact('17'), 'J’ai 17 ans')).toBeNull();
    expect(declaredAdultAge(fact('22'), 'J’ai 22 ans… enfin 16 ans en vrai')).toBeNull();
    expect(declaredAdultAge(fact('25'), 'J’ai 125 ans')).toBeNull();
    expect(declaredAdultAge(fact('25'), 'J’ai 25 ans. Bon ok je suis un mec de 16 ans')).toBeNull();
    expect(declaredAdultAge(fact('25'), '25 ans, mais en vrai 15 ans et un boulot d’été')).toBeNull();
    expect(declaredAdultAge(fact('25'), 'J’ai vingt-cinq ans… enfin seize ans')).toBeNull();
  });

  it('reads his age beside a time or his children’s ages, and in words (audit du 16/11, C4)', () => {
    expect(declaredAdultAge(fact('34'), 'J’ai 34 ans, marié depuis 6 ans')).toBe(34);
    expect(declaredAdultAge(fact('40'), '40 ans, deux enfants de 8 et 10 ans')).toBe(40);
    expect(declaredAdultAge(fact('29'), 'Ça fait 3 ans que je te suis, j’ai 29 ans')).toBe(29);
    expect(declaredAdultAge(fact('31'), 'J’ai 31 ans et 10 ans d’expérience')).toBe(31);
    expect(declaredAdultAge(fact('25'), 'J’ai vingt-cinq ans')).toBe(25);
    expect(declaredAdultAge(fact('vingt et un ans'), 'vingt et un ans et toi')).toBe(21);
    expect(declaredAdultAge(fact('quatre-vingts'), 'quatre vingts ans')).toBe(80);
  });
});
