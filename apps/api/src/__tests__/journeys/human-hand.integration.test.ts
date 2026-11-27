import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startJourney, type Journey } from '../support/agent-journey';

/**
 * A human takes a conversation and gives it back to the agent (audit IA, trous 1 and 5): from the dashboard, on the
 * real composer, his next message is answered again.
 */
describe('the hand given back to the agent', () => {
  let journey: Journey;

  beforeAll(async () => {
    journey = await startJourney();
  });

  afterAll(async () => {
    await journey.close();
  });

  // Once a human confirmed his age, his « 16 ans » read before that decision no longer hands him over (recette IA-02).
  it('answers his next message normally, and keeps the confirmation', async () => {
    journey.models({ voice: { bubbles: ['Je regarde une série, et toi ?'] } });
    const id = await journey.fanWrites('age-confirmed', 'j’ai 16 ans');
    await journey.respond(id);
    const { fanId, state } = await journey.state(id);
    expect(state).toBe('human');
    expect((await journey.flags(fanId)).ageDisputed).toBeDefined();

    // The owner saw his papers: she confirms his age with a reason, then hands the conversation back.
    const query = `creatorId=${journey.creatorId}`;
    const confirmed = await journey.asOwner('PUT', `/v1/fans/${fanId}/flags?${query}`, {
      flag: 'ageConfirmedAt',
      set: true,
      reason: 'Pièce d’identité vue en appel vidéo',
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const released = await journey.asOwner('POST', `/v1/conversations/${id}/release?${query}`, {});
    expect(released.statusCode, released.body).toBe(204);

    await journey.fanWrites('age-confirmed', 'tu fais quoi ?');
    await journey.respond(id);

    const flags = await journey.flags(fanId);
    expect(flags.ageConfirmedAt).toBeDefined();
    expect(flags.ageDisputed).toBeUndefined();
    expect((await journey.handoffs(id)).map((handoff) => handoff.cause)).toEqual(['minor']);
    expect((await journey.drafts(id)).map((draft) => draft.bubbles)).toEqual([
      ['Je regarde une série, et toi ?'],
    ]);
    expect((await journey.state(id)).state).toBe('awaiting_approval');
  });

  it('after a takeover and its release, the agent answers his next message again, and nothing meanwhile', async () => {
    journey.models({ voice: { bubbles: ['Coucou toi'] } });
    const query = `creatorId=${journey.creatorId}`;
    const id = await journey.fanWrites('released', 'salut');
    await journey.respond(id);
    expect((await journey.drafts(id)).map((draft) => draft.status)).toEqual(['pending']);

    const takeover = await journey.asOwner('POST', `/v1/conversations/${id}/takeover?${query}`, {});
    expect(takeover.statusCode, takeover.body).toBe(204);
    // While a human holds it, his message waits for that human: the agent writes nothing.
    await journey.fanWrites('released', 't’es là ?');
    await journey.respond(id);
    expect((await journey.state(id)).state).toBe('human');
    expect((await journey.drafts(id)).map((draft) => draft.status)).toEqual(['expired']);

    const released = await journey.asOwner('POST', `/v1/conversations/${id}/release?${query}`, {});
    expect(released.statusCode, released.body).toBe(204);
    journey.models({ voice: { bubbles: ['Je suis là, tu fais quoi ?'] } });
    await journey.fanWrites('released', 'coucou, tu réponds ?');
    await journey.respond(id);

    const drafts = await journey.drafts(id);
    expect(drafts.at(-1)).toMatchObject({ status: 'pending', bubbles: ['Je suis là, tu fais quoi ?'] });
    expect((await journey.state(id)).state).toBe('awaiting_approval');
    expect(await journey.handoffs(id)).toEqual([]);
    expect(journey.sender.sent).toEqual([]);
  });
});
