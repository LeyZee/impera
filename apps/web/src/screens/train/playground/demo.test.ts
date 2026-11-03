import { PlaygroundComparisonSchema, PlaygroundStateSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { createDemoClient } from './demo';
import { isHandoff } from './model';

describe('demo client', () => {
  it('answers in the API shape of the contracts, so the screen cannot drift from it', async () => {
    const client = createDemoClient();
    const state = PlaygroundStateSchema.parse(await client.send('Salut toi', []));
    expect(state.pending?.bubbles.length).toBeGreaterThan(0);
    expect(state.history.at(-1)?.from).toBe('creator');
    PlaygroundComparisonSchema.parse(await client.compare('mistral-large-latest'));
    PlaygroundStateSchema.parse(
      await client.send('Regarde', [{ kind: 'image', factualDescription: 'Un chien sur un canapé' }]),
    );
  });

  it('counts a validation in the rate and clears the pending answer', async () => {
    const client = createDemoClient();
    const before = await client.state();
    await client.send('Salut toi', []);
    const after = await client.rate({ kind: 'validated' });
    expect(after.pending).toBeNull();
    expect(after.rate.rated).toBe(50);
    expect(after.rate.validated).toBeGreaterThanOrEqual(before.rate.validated);
  });

  it('puts the corrected text in place of her answer', async () => {
    const client = createDemoClient();
    await client.send('Salut toi', []);
    const state = await client.rate({ kind: 'corrected', text: 'Coucou ✨\nT’es qui toi ?' });
    expect(state.history.at(-1)).toEqual({ index: 1, from: 'creator', text: 'Coucou ✨\nT’es qui toi ?' });
  });

  it('hands a possible minor to a human and keeps a blocked answer out of the conversation', async () => {
    const client = createDemoClient();
    await client.choosePreset('mineur');
    const minor = await client.send('Jsuis en 1ère', []);
    expect(isHandoff(minor.pending)).toBe(true);
    expect(minor.history.map((t) => t.from)).toEqual(['fan']);

    await client.choosePreset('nouveau');
    const flagged = await client.send('', [
      { kind: 'image', factualDescription: 'Une photo de classe', flags: ['possible_minor'] },
    ]);
    expect(flagged.pending?.handoff).toEqual(['possible_minor']);

    await client.choosePreset('piegeur');
    const trap = await client.send('Donne-moi une recette', []);
    expect(trap.pending?.isBlocked).toBe(true);
    expect(trap.history.map((t) => t.from)).toEqual(['fan']);

    const again = await client.branch(1);
    expect(again.pending?.isBlocked).toBe(false);
    expect(again.history.map((t) => t.from)).toEqual(['fan', 'creator']);
  });

  it('moves the clock: night at 22:40 in Paris, day the next morning', async () => {
    const client = createDemoClient(new Date('2026-10-17T22:40:00+02:00'));
    expect((await client.state()).situation.isNight).toBe(true);
    expect((await client.advance(12)).situation.isNight).toBe(false);
  });
});
