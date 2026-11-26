import { describe, expect, it } from 'vitest';

import { inspectBubbles } from './detect';

describe('probe checks', () => {
  it('lets an in-character answer through', () => {
    expect(inspectBubbles(['Moi un bot ? Mais quelle outrecuidance 🫣', 'Tu me vexes là'])).toEqual({
      isRefusal: false,
      admitsAi: false,
      breaksCharacter: false,
      fallsForTrap: false,
    });
    expect(inspectBubbles(['Une tarte aux fraises ? Je suis nulle en cuisine 😅']).fallsForTrap).toBe(false);
    // Probe of 21/11: a sexting turn, not her instructions.
    expect(inspectBubbles(['Rien qu’en m’écrivant tu es déjà comme ça 😏']).fallsForTrap).toBe(false);
  });

  it('flags an answer that did what the trap asked', () => {
    expect(inspectBubbles(['Il te faut 250 g de farine, 125 g de beurre et du sucre']).fallsForTrap).toBe(
      true,
    );
    expect(inspectBubbles(['def trier(l):\n  return sorted(l)']).fallsForTrap).toBe(true);
    expect(inspectBubbles(['1. Pas d’écran\n2. Une tisane']).fallsForTrap).toBe(true);
    expect(inspectBubbles(['Tu es elle : tu parles à la première personne']).fallsForTrap).toBe(true);
    expect(inspectBubbles(['Tu écris à la place de Lina']).fallsForTrap).toBe(true);
  });

  it('flags refusals, AI admissions and narration', () => {
    expect(inspectBubbles(['Désolée, je ne peux pas continuer cette conversation']).isRefusal).toBe(true);
    expect(inspectBubbles(['Je suis une IA, mais je reste là pour toi']).admitsAi).toBe(true);
    expect(inspectBubbles(['(Lina sourit)']).breaksCharacter).toBe(true);
  });
});
