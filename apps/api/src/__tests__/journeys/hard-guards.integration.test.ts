import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startJourney, type Journey } from '../support/agent-journey';

/**
 * The hard guards on the agent's real path (audit IA, trou 2): his message in base, the real composer with fake
 * models, the conversation and his limits as the database keeps them, and what left (nothing).
 */
describe('hard guards on a fan’s message, from the database to the send', () => {
  let journey: Journey;

  beforeAll(async () => {
    journey = await startJourney();
  });

  afterAll(async () => {
    await journey.close();
  });

  it('a fan who says he is 16: no model is asked, nothing is written or sent, a human takes him, his age in doubt', async () => {
    journey.models({});
    const brainCalls = journey.seen.brainInputs?.length ?? 0;
    const id = await journey.fanWrites('minor', 'j’ai 16 ans et toi ?');
    await journey.respond(id);

    const conversation = await journey.state(id);
    expect(conversation.state).toBe('human');
    expect((await journey.handoffs(id)).map((handoff) => handoff.cause)).toEqual(['minor']);
    const flags = await journey.flags(conversation.fanId);
    expect(flags.ageDisputed).toMatchObject({ by: 'policy' });
    expect(flags.ageConfirmedAt).toBeUndefined();
    expect(await journey.drafts(id)).toEqual([]);
    expect(journey.seen.brainInputs?.length ?? 0).toBe(brainCalls);
    expect(journey.sender.sent).toEqual([]);
  });

  it('a fan in distress: his sales frozen and nothing explicit, a care draft with the help waits for a human', async () => {
    journey.models({ voice: { bubbles: ['Je suis là pour toi, raconte-moi'] } });
    const id = await journey.fanWrites('distress', 'j’ai plus envie de vivre ce soir');
    await journey.respond(id);

    const conversation = await journey.state(id);
    expect(conversation.careSince).not.toBeNull();
    expect((await journey.journal(id)).map((event) => event.type)).toContain('care_opened');
    const flags = await journey.flags(conversation.fanId);
    expect(flags.salesFrozen).toMatchObject({ reason: 'distress' });
    expect(flags.noExplicit).toBe(true);
    const [draft, ...more] = await journey.drafts(id);
    expect(more).toEqual([]);
    // Written with care, the help bubble last; it waits for a human, nothing left.
    expect(draft?.status).toBe('pending');
    expect(draft?.bubbles[0]).toBe('Je suis là pour toi, raconte-moi');
    expect(draft?.bubbles.length).toBe(2);
    expect(conversation.state).toBe('awaiting_approval');
    expect(journey.sender.sent).toEqual([]);
  });

  it('the voice says she is an AI: the answer is dropped, a human takes him, nothing is sent', async () => {
    journey.models({ voice: { bubbles: ['Je suis une IA, désolée'] } });
    const id = await journey.fanWrites('ai-disclosure', 't’es une vraie ?');
    await journey.respond(id);

    expect((await journey.state(id)).state).toBe('human');
    const [handoff, ...more] = await journey.handoffs(id);
    expect(more).toEqual([]);
    expect(handoff?.cause).toBe('guard');
    expect(handoff?.detail).toEqual(['guard_blocked', 'ai_disclosure']);
    expect(await journey.drafts(id)).toEqual([]);
    expect(journey.sender.sent).toEqual([]);
  });

  it('the voice names a price no offer carries: the answer is dropped, a human takes him, nothing is sent', async () => {
    journey.models({ voice: { bubbles: ['Ma vidéo c’est 15 € pour toi'] } });
    const id = await journey.fanWrites('price', 'tu as des vidéos ?');
    await journey.respond(id);

    expect((await journey.state(id)).state).toBe('human');
    const [handoff, ...more] = await journey.handoffs(id);
    expect(more).toEqual([]);
    expect(handoff?.cause).toBe('guard');
    expect(handoff?.detail).toContain('price_outside_offer');
    expect(await journey.drafts(id)).toEqual([]);
    expect(journey.sender.sent).toEqual([]);
  });

  it('a chatter who types a price into her draft: the approval is refused, the draft stays, nothing is sent', async () => {
    journey.models({});
    const id = await journey.fanWrites('edited-price', 'coucou');
    await journey.respond(id);
    const [draft] = await journey.drafts(id);
    if (draft === undefined) throw new Error('no draft');

    await expect(
      journey.approve(id, draft.id, ['Coucou, ma vidéo c’est 20 € pour toi']),
    ).rejects.toMatchObject({ code: 'draft_unprocessable' });
    expect((await journey.drafts(id)).map((one) => one.status)).toEqual(['pending']);
    expect(journey.sender.sent).toEqual([]);
  });
});
