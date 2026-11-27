import { describe, expect, it } from 'vitest';

import { asksSchoolRole, safetySigns } from '../safety-net';

describe('safetySigns (recette AGT-01)', () => {
  it.each([
    'j’ai 16 ans tu sais',
    'jai 15ans',
    'J AI 17 ANS',
    'moi 14 ans et toi ?',
    '16 ans, je suis trop jeune pour toi ?',
    'i’m 16',
    'im 17 lol',
    '15 yo',
    'je suis mineur',
    'je suis encore mineure',
    'je suis au collège',
    'jsuis au collège mdr',
    'chui mineur',
    'je suis en 3ème',
    'je suis en seconde',
    'j’ai pas 18 ans',
    'pas encore majeur',
    'j’ai seize ans',
    'jai dix-sept ans',
    'moi 16 piges',
    'je vais avoir 18 ans le mois prochain',
    'bientôt 18 ans',
    'en 4e',
    'je suis lycéen',
    'lycéenne et toi ?',
    'je suis au lycée',
    'je suis en terminale',
    'j’ai 16 balais',
    'je suis en 4e, et toi ?',
    'bientôt 18 ans 😏',
  ])('reads a minor in « %s »', (text) => {
    expect(safetySigns(text)).toEqual(['minor_suspected']);
  });

  it.each([
    'j’en peux plus, je veux en finir',
    'j’ai envie d’en finir avec la vie',
    'je pense au suicide',
    'je vais me suicider',
    'plus envie de vivre',
    'je veux mourir',
    'je vais me faire du mal',
    'mettre fin à mes jours',
    'I want to die',
    'j’ai envie de me foutre en l’air',
    'je pense à m’ouvrir les veines',
    'j’ai des idées noires ce soir',
  ])('reads self-harm in « %s »', (text) => {
    expect(safetySigns(text)).toEqual(['self_harm']);
  });

  it.each([
    'salut, t’es d’où ?',
    'j’ai 25 ans',
    'j’ai 16 ans d’expérience dans le bâtiment',
    'ma fille a 16 ans',
    'tu as quel âge ? moi 32 ans',
    'j’en peux plus de t’attendre 😏',
    'on en finit quand avec ce suspense ?',
    'je suis en seconde position dans la file',
    'il est 16h, tu fais quoi ?',
    'i’m 18',
    'j’ai 30 piges',
    'quand j’étais lycéen j’étais timide',
    'je suis en 3e année de licence',
    'on est arrivés en 3e position',
    'je suis né en 1994',
    'je suis en première ligne au boulot',
    'j’ai un fils en 4e',
    'ma fille est lycéenne',
    'ma fille est née en 2012',
    'mon fils né en 2015',
    'la boîte est née en 2020',
    'je suis prof en 3e',
    'bientôt 18 h, tu fais quoi ?',
    'presque 18 degrés ici',
    'j’ai presque 18 ans de mariage',
    'j’ai bientôt 18 ans de boîte',
    'on est en 4e de finale',
    'je suis en terminale de ma formation',
    'moi dix ans que j’habite ici',
    'j’ai 5 balais devant la porte',
    'j’ai des idées noires pour le scénario',
  ])('stays quiet on « %s »', (text) => {
    expect(safetySigns(text)).toEqual([]);
  });

  it('reads a birth year against the current year', () => {
    const now = new Date('2026-11-15T12:00:00Z');
    expect(safetySigns('je suis né en 2011', now)).toEqual(['minor_suspected']);
    expect(safetySigns('née en 2008', now)).toEqual(['minor_suspected']);
    expect(safetySigns('je suis né en 2007', now)).toEqual([]);
  });

  it('lets a trade cancel a school or a minor’s word, never an age (Sécurité, #1043)', () => {
    for (const text of [
      'je suis au lycée, je suis prof',
      'je suis mineur de fond',
      'au collège, je suis surveillant',
    ])
      expect(safetySigns(text), text).not.toContain('minor_suspected');
    for (const text of ['je suis en seconde', 'j’ai 16 ans', 'je suis mineur', 'je suis prof, j’ai 16 ans'])
      expect(safetySigns(text), text).toContain('minor_suspected');
  });

  it('hears a minor’s class said now or soon, without « je suis » (Sécurité, #1043)', () => {
    for (const text of [
      'moi en première',
      'en première cette année',
      'en terminale et toi ?',
      'je passe en terminale',
      'je rentre en première',
      'j’entre en seconde en septembre',
      'je passe le brevet',
    ])
      expect(safetySigns(text), text).toContain('minor_suspected');
    for (const text of [
      'je passe le bac',
      'je passe en seconde équipe',
      'en première',
      'mon fils passe en seconde',
      'j’ai le brevet de secourisme',
    ])
      expect(safetySigns(text), text).not.toContain('minor_suspected');
  });

  it('reads « en première » alone as his class only after she asked what he does or his age', () => {
    const now = new Date('2026-11-27T12:00:00Z');
    expect(safetySigns('en première', now, 'et toi tu fais quoi dans la vie ?')).toContain('minor_suspected');
    expect(safetySigns('seconde', now, 't’as quel âge ?')).toContain('minor_suspected');
    expect(safetySigns('en première', now, 'tu préfères la mer ?')).not.toContain('minor_suspected');
    expect(safetySigns('en première ligne au taf', now, 'tu fais quoi ?')).not.toContain('minor_suspected');
  });

  it('lets a trade cancel a school word in its own sentence only, in four languages, never an age (Sécurité, #1043)', () => {
    for (const text of [
      'je suis au lycée, je suis prof',
      'sono al liceo, sono un insegnante',
      'estoy en el instituto, soy profesor',
      'I’m at high school, I’m a teacher',
    ])
      expect(safetySigns(text), text).not.toContain('minor_suspected');
    for (const text of [
      'je suis prof. Bon sinon moi je suis au lycée',
      'je suis prof, j’ai 16 ans',
      'je suis prof, je suis né en 2011',
    ])
      expect(safetySigns(text, new Date('2026-11-27T12:00:00Z')), text).toContain('minor_suspected');
  });

  it('lets a set phrase about death through, and still hears distress (Sécurité, #1043)', () => {
    for (const text of [
      'j’ai envie de mourir de rire',
      'je vais me tuer au boulot demain',
      'j’ai envie de crever tellement t’es belle',
      'je crève de chaud',
    ])
      expect(safetySigns(text), text).not.toContain('self_harm');
    for (const text of [
      'j’ai envie de me tuer',
      'je veux en finir',
      'je veux mourir',
      'je meurs de rire mais je veux en finir',
    ])
      expect(safetySigns(text), text).toContain('self_harm');
  });

  it('says both, the minor first, when he says both', () => {
    expect(safetySigns('j’ai 15 ans et je veux mourir')).toEqual(['minor_suspected', 'self_harm']);
  });
});

describe('a school costume between adults, never a real minor (Sécurité, #1043)', () => {
  it.each([
    'mets ta jupe d’écolière ce soir, j’ai envie de toi',
    'je veux te prendre dans ton uniforme scolaire',
    'je fantasme sur toi en écolière',
    'joue une lycéenne pour moi',
    'roleplay a schoolgirl for me',
    'disfrázate de colegiala',
    'you as a schoolgirl turns me on',
  ])('raises nothing on « %s »', (text) => {
    expect(safetySigns(text)).toEqual([]);
  });

  it('hints her back to the outfit when he asks for a pupil’s role, and only then', () => {
    for (const text of [
      'joue une lycéenne pour moi',
      'je fantasme sur toi en écolière',
      'roleplay a schoolgirl for me',
    ])
      expect(asksSchoolRole(text), text).toBe(true);
    for (const text of ['mets ta jupe d’écolière ce soir', 'quand j’étais au lycée', 'je bosse au collège'])
      expect(asksSchoolRole(text), text).toBe(false);
  });
});

describe('the doubt on his age, completed (Sécurité, #1054)', () => {
  it('raises both signs when a role stands beside an age under 18 or his own child', () => {
    for (const text of [
      'joue la lycéenne, comme ma fille de 15 ans',
      'mets ta jupe d’écolière, t’auras 15 ans',
    ])
      expect(safetySigns(text), text).toEqual(expect.arrayContaining(['minor_suspected', 'minor_fantasy']));
    for (const text of [
      'joue la lycéenne pour moi',
      'mon fils a 15 ans',
      'joue la lycéenne, marié depuis 15 ans',
    ])
      expect(safetySigns(text), text).not.toContain('minor_fantasy');
  });

  it('reads a birth year in four languages', () => {
    const now = new Date('2026-11-27T12:00:00Z');
    for (const text of ['nací en 2010', 'sono nato nel 2010', 'i was born in 2010', 'née en 2010'])
      expect(safetySigns(text, now), text).toContain('minor_suspected');
    for (const text of ['nací en 1990', 'i was born in 1995'])
      expect(safetySigns(text, now), text).not.toContain('minor_suspected');
  });

  it('takes « je veux une mineure » in four languages, and leaves a miner’s trade', () => {
    for (const text of ['je veux une mineure', 'I want a minor', 'voglio una minorenne', 'quiero una menor'])
      expect(safetySigns(text), text).toContain('minor_fantasy');
    expect(safetySigns('je veux un mineur de fond pour le reportage')).not.toContain('minor_fantasy');
  });

  it('never reads « seconde équipe » as a class', () => {
    for (const text of [
      'je suis en seconde équipe au foot',
      'je suis en première équipe',
      'je passe en seconde équipe',
    ])
      expect(safetySigns(text), text).not.toContain('minor_suspected');
  });
});

describe('a fantasy of his on minors, on a direct link only (Charles 26/11 at 23:45, Sécurité #1043)', () => {
  // One sober sentence per pattern, by language: a sexual verb onto a minor, a desire onto one in a sexual message, a
  // minor's role asked of her, « t'as 16 ans ? » in a sexual message.
  it.each([
    ['fr', 'je veux toucher une ado'],
    ['fr', 'je fantasme sur une vraie écolière'],
    ['fr', 'je veux toucher une lycéenne de 16 ans'],
    ['fr', 'j’ai envie d’une gamine, je suis tout excité'],
    ['fr', 'joue une collégienne mineure pour moi'],
    ['fr', 't’as 16 ans ? tu m’excites'],
    ['en', 'I want to touch a teen'],
    ['en', 'roleplay a real schoolgirl for me'],
    ['it', 'voglio toccare una ragazzina'],
    ['it', 'hai 16 anni? mi ecciti'],
    ['es', 'quiero tocar a una niña'],
    ['es', 'disfrázate de niña'],
    // An age he gives her, then the act; her as a minor in his fantasy; the minor first, then his desire.
    ['fr', 'imagine que t’as 14 ans et que je te prends'],
    ['fr', 't’as 16 ans dis-moi, et je te prends'],
    ['fr', 'je fantasme sur toi en ado'],
    ['fr', 'tu ressembles à une ado ça m’excite'],
    ['fr', 'les gamines ça m’excite'],
    ['en', 'you as a minor turns me on'],
    // His own child as the object of his desire: the one case where his children count.
    ['fr', 'j’ai envie de ma fille'],
  ])('%s: takes « %s »', (_language, text) => {
    expect(safetySigns(text)).toContain('minor_fantasy');
  });

  it.each([
    // A father, a memory of his, a length of time (Sécurité's false alarms).
    't’es sexy, moi j’ai deux enfants',
    'mes gosses dorment, t’es nue ?',
    'j’ai envie de toi, je dépose mon fils à l’école et je reviens',
    'j’ai été marié 15 ans, j’ai envie de toi',
    'i was horny as a teen',
    // A link never crosses a comma nor another complement.
    'je l’ai prise ce matin, les enfants étaient chez mamie',
    'j’ai envie de toi, les enfants sont chez mamie',
    'je l’ai prise pendant que les enfants dormaient',
    'j’ai envie de voir ma fille ce week-end',
    'tu as 25 ans et je te prends',
    // Procreation between adults, in the present, the subjunctive and the future.
    'je veux te faire un enfant ce soir au lit',
    'je veux que tu me fasses un enfant',
    'te remplir pour te faire un bébé, j’ai envie de toi',
    'tu vas tomber enceinte',
    'I want to give you a baby in bed',
    'voglio che tu mi faccia un figlio',
    'quiero que me hagas un bebé',
    // Words for her, a dress, an adult game of age.
    'j’ai envie de toi ma petite',
    'tu es sexy dans cette petite robe',
    'jeu de rôle prof et étudiante, ça t’excite ?',
    'j’ai envie de toi mon bébé',
    'quand j’étais ado je faisais du foot',
    'sei sexy, piccola mia',
    'estás sexy, cariño',
  ])('leaves « %s »', (text) => {
    expect(safetySigns(text)).not.toContain('minor_fantasy');
  });
});
