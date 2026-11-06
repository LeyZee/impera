import { describe, expect, it } from 'vitest';

import { cn, deOf, frenchSpaces, initialOf } from './utils';

describe('cn', () => {
  it('keeps the last conflicting Tailwind utility', () => {
    expect(cn('px-2 text-ink', 'px-4')).toBe('text-ink px-4');
  });
});

describe('initialOf', () => {
  it('takes the first character as seen, never half of an emoji (recette 28/10, M4)', () => {
    expect(initialOf('léa')).toBe('L');
    expect(initialOf('💋')).toBe('💋');
    expect(initialOf('👍🏽')).toBe('👍🏽');
    expect(initialOf('  ')).toBe('?');
  });

  it('takes the first letter, past what is not one (recette 05/11, PRO-17)', () => {
    expect(initialOf('<b>Fan</b><script>alert(1)</script>')).toBe('B');
    expect(initialOf('« Élodie »')).toBe('É');
    // An emoji stays the initial, whole: Suivi shows a pseudo's own.
    expect(initialOf('💋 Dashboard-Fan 1')).toBe('💋');
    expect(initialOf('→ 👍🏽 Théo')).toBe('👍🏽');
  });
});

describe('deOf', () => {
  it('elides « de » before a vowel, accented or not (recette 05/11, PRO-16)', () => {
    expect(deOf('Anastasia-Maria')).toBe('d’Anastasia-Maria');
    expect(deOf('Émilie')).toBe('d’Émilie');
    expect(deOf('Yvonne')).toBe('d’Yvonne');
    expect(deOf('Yasmine')).toBe('de Yasmine');
    expect(deOf('Léa')).toBe('de Léa');
  });
});

describe('frenchSpaces', () => {
  it('keeps « : ; ? ! » and the quotes on the word before them', () => {
    expect(frenchSpaces('Elle n’a pas de persona active : l’agent n’écrit rien. « Oui » ? Non !')).toBe(
      'Elle n’a pas de persona active : l’agent n’écrit rien. « Oui » ? Non !',
    );
    expect(frenchSpaces('Déjà : rien à changer.')).toBe('Déjà : rien à changer.');
  });
});
