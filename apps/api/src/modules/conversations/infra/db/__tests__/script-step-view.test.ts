import { describe, expect, it } from 'vitest';

import { scriptStepView, stepKey } from '../reader';

const step = {
  scriptRef: 'script-demo',
  stepIndex: 1,
  stepRef: 'step-2',
  priceMinor: 900,
  hasMedia: true,
  idempotencyKey: 'script-step:conv:script-demo:1:1',
};

describe('the step of her script under a draft (recette REV-03)', () => {
  it('says the script, the step, its price and its media, as the platform names them', () => {
    const names = new Map([
      [stepKey('script-demo', 'step-2'), { scriptName: 'Café du matin', stepName: 'Photo' }],
    ]);
    expect(scriptStepView(step, names)).toEqual({
      scriptName: 'Café du matin',
      stepIndex: 1,
      stepName: 'Photo',
      priceMinor: 900,
      currency: 'EUR',
      hasMedia: true,
    });
  });

  it('still says the step and its price when the catalogue no longer names it', () => {
    expect(scriptStepView(step, new Map())).toMatchObject({
      scriptName: null,
      stepName: null,
      priceMinor: 900,
    });
  });

  it('says nothing for a draft that sends no step', () => {
    expect(scriptStepView(null, new Map())).toBeNull();
  });
});
