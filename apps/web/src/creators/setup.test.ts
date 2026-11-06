import { describe, expect, it } from 'vitest';

import { isSetUp, setupSteps } from './setup';

const invited = { email: 'creatrice@example.test', invitationPending: true, invitationExpiresAt: null };

describe('what is left to set up for a creator (CRM-07 b2)', () => {
  it('lists the persona, the percentage and her access, all to do for a creator just imported', () => {
    const steps = setupSteps({ personaVersions: 0, hasRate: false, account: null });
    expect(steps.map((step) => [step.sheet, step.state])).toEqual([
      ['persona', 'todo'],
      ['rate', 'todo'],
      ['access', 'todo'],
    ]);
    expect(isSetUp(steps)).toBe(false);
  });

  it('says an invitation out and not opened waits on her, and keeps the card', () => {
    const steps = setupSteps({ personaVersions: 1, hasRate: true, account: invited });
    expect(steps.find((step) => step.sheet === 'access')).toMatchObject({
      state: 'waiting',
      hint: 'Invitation envoyée, pas encore ouverte.',
    });
    expect(isSetUp(steps)).toBe(false);
  });

  it('is set up once she has a persona, a percentage and her access opened', () => {
    const steps = setupSteps({
      personaVersions: 2,
      hasRate: true,
      account: { ...invited, invitationPending: false },
    });
    expect(isSetUp(steps)).toBe(true);
  });
});
