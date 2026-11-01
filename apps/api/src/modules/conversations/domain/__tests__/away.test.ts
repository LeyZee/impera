import { describe, expect, it } from 'vitest';

import { awayReleaseReason } from '../away';

describe('the reason of a conversation handed back because its member is away (EQ-13)', () => {
  it('says each status other than active, in French', () => {
    expect(
      (['on_leave', 'sick', 'travelling', 'suspended', 'left'] as const).map((status) =>
        awayReleaseReason(status),
      ),
    ).toEqual([
      'Rendue automatiquement : le membre qui la tenait est en congé.',
      'Rendue automatiquement : le membre qui la tenait est malade.',
      'Rendue automatiquement : le membre qui la tenait est en déplacement.',
      'Rendue automatiquement : le membre qui la tenait est suspendu.',
      'Rendue automatiquement : le membre qui la tenait est parti.',
    ]);
  });
});
