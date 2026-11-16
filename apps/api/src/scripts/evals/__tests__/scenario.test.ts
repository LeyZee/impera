import { describe, expect, it } from 'vitest';

import { readScenario } from '../scenario';

const SCENARIO = `
description: Il répond tard, fictif.
persona_version: demo
situation:
  known_hours: 50
history:
  - from: creator
    text: Dors bien toi
    minutes_ago: 600
inbound: Coucou toi
expect:
  decision:
    handoff: false
`;

describe('a scenario where she answers late (audit du naturel, A2)', () => {
  it('reads how long ago he wrote his message', () => {
    expect(readScenario(`${SCENARIO}inbound_minutes_ago: 120\n`).inbound_minutes_ago).toBe(120);
    expect(readScenario(SCENARIO).inbound_minutes_ago).toBeUndefined();
  });

  it('refuses a time in the future', () => {
    expect(() => readScenario(`${SCENARIO}inbound_minutes_ago: -5\n`)).toThrow(/inbound_minutes_ago/);
  });
});
