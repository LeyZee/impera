import { describe, expect, it } from 'vitest';

import {
  checkWelcome,
  declaredAdultAge,
  sexualizationDecision,
  type SexualizationContext,
} from '../sexualization';

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

  it('never on a minor’s future, a kin word after his age, or a loose exemption (relecture Sécurité, #798)', () => {
    expect(declaredAdultAge(fact('18'), 'J’ai 18 ans dans 2 ans')).toBeNull();
    expect(declaredAdultAge(fact('18'), 'J’ai 18 ans, enfin 17 ans comme mon frère')).toBeNull();
    expect(declaredAdultAge(fact('18'), 'J’ai 18 ans, enfin 17 ans de toute façon')).toBeNull();
    expect(declaredAdultAge(fact('18'), 'Bon j’ai 17 ans d’ailleurs mais disons 18 ans')).toBeNull();
    expect(declaredAdultAge(fact('18'), 'jai 18ans mais en vrai jen ai 15')).toBeNull();
    expect(declaredAdultAge(fact('18'), '18 ans dans 3 semaines')).toBeNull();
    expect(declaredAdultAge(fact('18'), '18 ans, enfin dans 6 mois')).toBeNull();
    expect(declaredAdultAge(fact('18'), 'Bientôt 18 ans')).toBeNull();
    expect(declaredAdultAge(fact('18'), 'j’ai 18 ans. Enfin presque')).toBeNull();
  });

  it('confirms nothing on a negation, a future, an approximation or a stray number (relecture Sécurité, #798)', () => {
    for (const text of [
      'je n’ai pas 18 ans',
      'j’ai moins de 18 ans',
      'j’ai 18 ans l’année prochaine',
      '18 ans en juin',
      'j’ai 18 ans demain',
      'j’ai 18 ans le 12',
      'j’ai 18 ans dans pas longtemps',
      'j’ai quasi 18 ans',
      'j’ai 18 ans mdr non 15',
      '18 ans mais g 15',
      'j’ai 18 ans … 16',
      'j’ai 18 ans moins 2',
      'j’ai même pas 20 ans',
      'jai 19 ans je crois',
    ])
      expect(
        declaredAdultAge(fact(text.includes('19') ? '19' : text.includes('20') ? '20' : '18'), text),
      ).toBeNull();
  });

  it('confirms 18 to 20 only in a plain positive clause', () => {
    expect(declaredAdultAge(fact('18'), 'J’ai 18 ans et toi ?')).toBe(18);
    expect(declaredAdultAge(fact('19'), 'moi c’est 19 😊')).toBe(19);
    expect(declaredAdultAge(fact('18'), 'je viens d’avoir 18 ans')).toBe(18);
    expect(declaredAdultAge(fact('20'), 'Salut ! 20 ans')).toBe(20);
    expect(declaredAdultAge(fact('18'), 'j’ai 18 ans tkt')).toBeNull();
  });

  it('exempts only the number right after a kin word (relecture Sécurité, #798, A)', () => {
    expect(declaredAdultAge(fact('25'), 'mon frere a 25 ans moi 16')).toBeNull();
    expect(declaredAdultAge(fact('38'), 'J’ai 38 ans, mon fils de 6 ans dort')).toBe(38);
  });

  it('confirms only a plain positive clause of his, whatever the age (relecture Sécurité, #798, B)', () => {
    for (const text of [
      'je fais 25 ans',
      'on me donne 25 ans',
      'je dis que j’ai 25 ans',
      'si j’avais 25 ans',
      'j’ai 25 ans ou pas',
      'j’ai 25 ans non je rigole',
      'tu as 25 ans ?',
      'ma copine a 25 ans',
      '25 ans, 4eme',
    ])
      expect(declaredAdultAge(fact('25'), text)).toBeNull();
    expect(declaredAdultAge(fact('45'), 'mon pere a 45 ans')).toBeNull();
    expect(declaredAdultAge(fact('18'), 'oui j’ai 18 ans')).toBe(18);
    expect(declaredAdultAge(fact('18'), 'j’ai 18 ans promis')).toBeNull();
  });

  it('still confirms the plain adults', () => {
    expect(declaredAdultAge(fact('25'), 'j’ai 25 ans')).toBe(25);
    expect(declaredAdultAge(fact('32'), '32 ans, marié depuis 6 ans')).toBe(32);
    expect(declaredAdultAge(fact('40'), '40 ans et ma fille a 8 ans')).toBe(40);
    expect(declaredAdultAge(fact('28'), '28 ans et 10 ans d’expérience')).toBe(28);
    expect(declaredAdultAge(fact('25'), 'vingt-cinq ans')).toBe(25);
  });

  it('still reads an adult beside the closed exemptions and someone else’s age', () => {
    expect(declaredAdultAge(fact('35'), 'J’ai 35 ans, ma fille a 12 ans')).toBe(35);
    expect(declaredAdultAge(fact('42'), 'J’ai 42 ans et 15 ans de mariage')).toBe(42);
    expect(declaredAdultAge(fact('30'), 'J’ai 30 ans, 12 ans d’ancienneté')).toBe(30);
    expect(declaredAdultAge(fact('28'), 'J’ai 28 ans et j’ai 15 minutes de pause')).toBe(28);
    expect(declaredAdultAge(fact('19'), 'J’ai dix-neuf ans')).toBe(19);
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

describe('checkWelcome (Charles, 20/11)', () => {
  it('refuses a brake on a fan who only compliments her', () => {
    for (const bubble of [
      'Coucou toi ! Tu y vas un peu fort, non 😏',
      'Doucement toi 😅',
      'Tu t’emballes un peu là',
      'Oh là, pas si vite',
      'On se calme 😂',
      'Merci, tu vises direct 😏',
      'T’es direct toi dis donc',
      'Toi t’es pas du genre à perdre du temps... tu perds pas de temps',
      'Tu commences fort 😅',
      'T’es bien pressé',
      'Dès le premier message ?',
      'Ahah on se connaît à peine',
    ]) {
      expect(
        checkWelcome([bubble]).map((violation) => violation.code),
        bubble,
      ).toEqual(['unwarranted_brake']);
    }
  });

  it('lets a welcome through: she takes the compliment and thanks him', () => {
    expect(checkWelcome(['Je sais 😏', 'Merci, c’est trop mignon de ta part'])).toEqual([]);
    expect(checkWelcome(['Ahah ça me fait plaisir, tu fais quoi de beau ce soir ?'])).toEqual([]);
    expect(checkWelcome(['Je sais 😏 merci', 'Et toi tu fais quoi dans la vie ?'])).toEqual([]);
    // « direct » about something else is no comment on him.
    expect(checkWelcome(['Merci 🥰 je suis en direct sur ma story ce soir, tu passes ?'])).toEqual([]);
  });
});
