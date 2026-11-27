import { describe, expect, it } from 'vitest';

import { NO_QUESTION_HINT, paceHints, QUIET_FAN_HINT, TALKATIVE_FAN_HINT } from '../pace';

describe('paceHints: getting to know him at his pace, never a questionnaire (Playground, Charles 16/11)', () => {
  it('asks a quiet fan an open question on what he said, and lets a talkative one tell', () => {
    expect(paceHints('Lyon et toi ?', [])).toEqual([QUIET_FAN_HINT]);
    const long =
      'Je suis de Lyon aussi, enfin pas tout à fait, j’ai grandi à Villeurbanne et je suis arrivé en centre-ville il y a trois ans pour le boulot, et franchement je ne repartirais pour rien au monde';
    expect(paceHints(long, [])).toEqual([TALKATIVE_FAN_HINT]);
    expect(paceHints('Je bosse dans le bâtiment, chef de chantier depuis quelques années', [])).toEqual([]);
  });

  it('leaves out an emoji she put in each of her last two turns', () => {
    const turns = [['J’ai 23 ans ✨ et toi ?'], ['Yes c’est parfait ✨', 'T’es d’où ?']];
    expect(paceHints('Lyon et toi ?', turns)).toEqual([NO_QUESTION_HINT, 'pas de ✨ cette fois, varie']);
    expect(paceHints('Lyon et toi ?', [['J’ai 23 ans ✨'], ['Trop bien 😅']])).toEqual([QUIET_FAN_HINT]);
    expect(paceHints('Lyon et toi ?', [['Coucou ✨']])).toEqual([QUIET_FAN_HINT]);
  });

  it('asks nothing when her last answer asked him something (Charles 21/11, no questionnaire)', () => {
    expect(paceHints('ok', [['Tu fais quoi ce soir ?']])).toEqual([NO_QUESTION_HINT]);
    expect(paceHints('ok', [['Trop bien 😅']])).toEqual([QUIET_FAN_HINT]);
  });
});
