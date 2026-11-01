import { GUARD_CODES } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  checkExplicit,
  checkVoiceOutput,
  DEFAULT_GUARD_SETTINGS,
  previousTurnsOf,
  type GuardCode,
  type GuardContext,
} from '../guards';

const codes = (bubbles: string[], context: GuardContext = {}): GuardCode[] =>
  checkVoiceOutput(bubbles, DEFAULT_GUARD_SETTINGS, context).map((v) => v.code);
const severities = (bubbles: string[], context: GuardContext) =>
  checkVoiceOutput(bubbles, DEFAULT_GUARD_SETTINGS, context).map((v) => [v.code, v.severity]);

/** P3-13: the voice slips Desirely corrects, so that none reaches a fan, from the agent or a chatter (G5). */
describe('voice guards (P3-13)', () => {
  it('blocks a stage direction between asterisks or brackets, and lets her emojis and asides through', () => {
    expect(codes(['*sourit* t’es mignon toi'])).toEqual(['stage_direction']);
    expect(codes(['Arrête (rires) tu me fais trop rire'])).toEqual(['stage_direction']);
    expect(codes(['*t’envoie un bisou*'])).toEqual(['stage_direction']);
    expect(codes(['(Clin d’œil) tu verras bien'])).toEqual(['stage_direction']);
    expect(codes(['Haha non 😏 tu verras 😘'])).not.toContain('stage_direction');
    // Her own aside in brackets is not an action.
    expect(codes(['J’ai fini (enfin presque) ma journée'])).toEqual([]);
    expect(codes(['Note 5*/5 pour toi 😌'])).toEqual([]);
    // A word stressed between asterisks is hers (relecture de #226).
    expect(codes(['c’est *trop* bon 😏'])).toEqual([]);
    expect(codes(['t’es *vraiment* pas sage toi'])).toEqual([]);
  });

  it('blocks a media she says she sent when the draft carries none', () => {
    const none: GuardContext = { hasMedia: false };
    expect(codes(['Je t’envoie une photo 📸'], none)).toEqual(['media_not_sent']);
    expect(codes(['Regarde ce que je viens de t’envoyer 🙈'], none)).toEqual(['media_not_sent']);
    expect(codes(['Voilà la vidéo dont je te parlais'], none)).toEqual(['media_not_sent']);
    expect(codes(['Je t’ai envoyé deux photos'], none)).toEqual(['media_not_sent']);
    // With the media, the same sentence is true.
    expect(codes(['Je t’envoie une photo 📸'], { hasMedia: true })).toEqual([]);
    // An offer, a promise for later, a kiss: hers.
    expect(codes(['Tu veux que je t’envoie une photo ?'], none)).toEqual([]);
    expect(codes(['tu veux je t’envoie une photo ?'], none)).toEqual([]);
    expect(codes(['je t’envoie une photo ?'], none)).toEqual([]);
    expect(codes(['Hmm… je t’envoie une photo ? 😏'], none)).toEqual([]);
    expect(codes(['Je t’envoie une photo demain 😘'], none)).toEqual([]);
    expect(codes(['Je t’envoie plein de bisous'], none)).toEqual([]);
    expect(codes(['Je t’ai envoyé un bisou ce matin'], none)).toEqual([]);
    // Unknown whether the draft carries one: not read.
    expect(codes(['Je t’envoie une photo 📸'])).toEqual([]);
  });

  it('blocks the meeting words the platforms flag, even in a refusal, and lets her tic and her life through', () => {
    for (const bubble of [
      'Pas de rdv, désolée 😇',
      'Un rendez-vous ? Non 😅',
      'On ne va pas se rencontrer tu sais',
      'Je ne veux pas te rencontrer',
      'Pas d’IRL avec moi',
      'Se voir en vrai, jamais',
      'Une rencontre réelle c’est non',
      // The platform reads the word, whatever it means.
      'Je vais te rencontrer dans mes rêves 😘',
    ]) {
      expect(codes([bubble]), bubble).toContain('platform_meeting_word');
    }
    for (const bubble of [
      'En vrai t’es drôle',
      'J’ai rencontré une copine au café ce midi',
      'On se voit au prochain live ?',
      'J’ai fait une belle rencontre au travail',
    ]) {
      expect(codes([bubble]), bubble).toEqual([]);
    }
  });

  it('blocks an illness, a debt or the rent used to sell, and lets a plain fact of her life through', () => {
    expect(codes(['Je suis malade, prends mon pack pour m’aider 🥺'])).toContain('fake_emergency');
    expect(codes(['Mon loyer est en retard…', 'si tu débloques la vidéo ça m’aiderait'])).toEqual([
      'fake_emergency',
    ]);
    expect(codes(['J’ai besoin d’argent ce mois-ci'])).toEqual(['fake_emergency']);
    expect(codes(['Je suis crevée ce soir 😴'])).toEqual([]);
    expect(codes(['J’étais malade hier, ça va mieux 🙂'])).toEqual([]);
    // A catchword, and a past fact with no tie to the sale (relecture de #226).
    expect(codes(['ce pack c’est une urgence 😏'])).toEqual([]);
    expect(codes(['j’étais malade hier mais là ça va, tu veux voir mon pack ?'])).toEqual([]);
  });

  it('warns on a bubble sent again or a third same opening, without blocking', () => {
    const previousTurns = [['Coucou toi, bien dormi ?'], ['Coucou toi 😘', 'Tu fais quoi de beau ce soir ?']];
    expect(severities(['Coucou toi, ça va ?'], { previousTurns })).toEqual([['repetition', 'soft']]);
    expect(
      severities(['Tu fais quoi de beau ce soir ?'], { previousTurns: [['Hey'], previousTurns[1] ?? []] }),
    ).toEqual([['repetition', 'soft']]);
    // Twice is a habit, a short bubble is a « ok ».
    expect(codes(['Coucou toi, ça va ?'], { previousTurns: previousTurns.slice(1) })).toEqual([]);
    expect(codes(['ok 😘'], { previousTurns: [['ok 😘']] })).toEqual([]);
  });

  it('warns on a third closed question in a row, and not when one of them was open', () => {
    const closed = [['Tu as passé une bonne journée ?'], ['Tu aimes le sport ?']];
    expect(severities(['Et tu as des frères et sœurs ?'], { previousTurns: closed })).toEqual([
      ['closed_question_streak', 'soft'],
    ]);
    expect(
      codes(['Et tu as des frères et sœurs ?'], {
        previousTurns: [['Raconte, c’était comment ?'], ['Tu aimes le sport ?']],
      }),
    ).toEqual([]);
    expect(codes(['Raconte-moi ta journée ?'], { previousTurns: closed })).toEqual([]);
  });

  it('groups her messages into turns between his, within the last twenty messages', () => {
    const her = (text: string) => ({ fromFan: false, text });
    const him = (text: string) => ({ fromFan: true, text });
    expect(previousTurnsOf([her('a'), him('b'), her('c'), her('d'), him('e'), her('f')])).toEqual([
      ['a'],
      ['c', 'd'],
      ['f'],
    ]);
    const long = Array.from({ length: 25 }, (_, i) =>
      i % 2 === 0 ? her(`h${String(i)}`) : him(`f${String(i)}`),
    );
    expect(previousTurnsOf(long)[0]).toEqual(['h6']);
  });

  it('emits only codes of GUARD_CODES, and each of them has a case that emits it', () => {
    const settings = { ...DEFAULT_GUARD_SETTINGS, forbiddenTerms: ['brocoli'], petNames: ['loulou'] };
    const read = (bubbles: string[], context: GuardContext = {}) =>
      checkVoiceOutput(bubbles, settings, context).map((v) => v.code);
    const emitted = new Set<string>([
      ...read(['Je suis une IA', 'je t’aime', 'On se voit samedi ?', 'mon snap c’est lina']),
      ...read([
        'Voici la recette : 200 g de farine',
        'n’hésite pas',
        'J’adore le brocoli',
        'salut mon chéri',
      ]),
      ...read(['a', 'b', 'c', 'd', 'x'.repeat(300)]),
      ...read(['Envoie-moi des nudes', 'sale radin', 'rien à payer', 'je te fais un petit prix']),
      ...read(['tu me déçois', '*sourit*', 'pas de rdv', 'j’ai besoin d’argent']),
      ...read(['Je t’envoie une photo'], { hasMedia: false }),
      ...read(['Tu fais quoi de beau ce soir ?'], {
        previousTurns: [['Tu aimes le sport ?'], ['Tu fais quoi de beau ce soir ?']],
      }),
      ...read(['Tu as un chien ?'], { previousTurns: [['Tu aimes le sport ?'], ['Tu bosses demain ?']] }),
      ...checkExplicit(['J’ai envie de te sucer']).map((v) => v.code),
    ]);
    const known: readonly string[] = GUARD_CODES;
    expect([...emitted].filter((code) => !known.includes(code))).toEqual([]);
    expect(known.filter((code) => !emitted.has(code))).toEqual([]);
  });
});
