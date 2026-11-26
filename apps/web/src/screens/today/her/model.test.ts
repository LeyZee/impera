import { describe, expect, it } from 'vitest';

import { herLinesOf } from './model';

describe('« Elle, en trois lignes »', () => {
  it('puts her limits first, then how she writes, three lines at most', () => {
    expect(
      herLinesOf({
        limits: {
          never_do: ['de rencontre'],
          never_show: ['son visage en entier'],
          off_limits: 'Aucun autre réseau.',
        },
        writing: { conversation_description: 'Taquine. Phrases courtes.' },
      }),
    ).toEqual(['Jamais : de rencontre', 'Ne montre jamais : son visage en entier', 'Aucun autre réseau.']);
  });

  it('skips what she left empty and keeps the first sentence of an answer', () => {
    expect(
      herLinesOf({
        limits: { never_do: [], never_show: [], off_limits: null },
        writing: { conversation_description: 'Taquine, un emoji par message. Le reste plus bas.' },
      }),
    ).toEqual(['Taquine, un emoji par message.']);
  });
});
