import { LlmCallIdSchema, newId } from '@impera/contracts';
import { schema } from '@impera/db';
import {
  createLlmGateway,
  createModelResolver,
  createPersistentCallLog,
  DEFAULT_LLM_CONFIG,
  type BudgetEvent,
  type PersistentCallLog,
} from '@impera/llm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startJourney, T0, type Journey } from '../support/agent-journey';

/** Where a call would go if the cap let one through: nowhere, it fails at once instead of leaving the machine. */
const NOWHERE = 'http://127.0.0.1:1';

/**
 * The day's AI budget spent while fans write (audit IA, trou 4): the real gateway, its cap and its journal of the day
 * in `llm_calls`, at a fixed hour; nothing is generated, nothing leaves, a human takes over for the budget.
 */
describe('a fan’s message once the day’s AI budget is spent', () => {
  let journey: Journey;
  let log: PersistentCallLog | null = null;
  const crossings: BudgetEvent[] = [];

  const callsJournaled = async () => (await journey.test.admin.db.select().from(schema.llmCalls)).length;

  beforeAll(async () => {
    journey = await startJourney({
      gateway: async (app, clock) => {
        // 30 $ of calls an hour ago, today in Paris: past the code's 25 € cap.
        await app.adminDb.db.insert(schema.llmCalls).values({
          id: newId(LlmCallIdSchema),
          role: 'voice',
          provider: 'xai',
          model: 'grok-4.7',
          promptHash: 'hash-invente',
          latencyMs: 900,
          status: 'ok',
          costMicroUsd: 30_000_000,
          createdAt: new Date(T0.getTime() - 3_600_000),
        });
        const now = () => clock.now();
        log = await createPersistentCallLog(app.llmCalls, {
          timeZone: DEFAULT_LLM_CONFIG.dailyBudget.timeZone,
          onError: () => undefined,
          now,
        });
        const keys = () => 'cle-de-test';
        return createLlmGateway({
          config: DEFAULT_LLM_CONFIG,
          credentials: keys,
          resolveModel: createModelResolver(keys, { xai: NOWHERE, google: NOWHERE, mistral: NOWHERE }),
          log,
          now,
          onBudget: (event) => crossings.push(event),
        });
      },
    });
  });

  afterAll(async () => {
    log?.stop();
    await journey.close();
  });

  it('writes nothing and sends nothing, hands each fan to a human for the budget, and says each threshold once', async () => {
    const first = await journey.fanWrites('budget-1', 'coucou');
    await journey.respond(first);
    const second = await journey.fanWrites('budget-2', 'tu es là ?');
    await journey.respond(second);

    for (const id of [first, second]) {
      expect((await journey.state(id)).state).toBe('human');
      const [handoff, ...more] = await journey.handoffs(id);
      expect(more).toEqual([]);
      expect(handoff?.cause).toBe('budget');
      expect(handoff?.detail[0]).toBe('budget_reached');
      expect(await journey.drafts(id)).toEqual([]);
    }
    // No model was called: the journal holds the day's spend alone.
    expect(await callsJournaled()).toBe(1);
    expect(journey.sender.sent).toEqual([]);
    // Each threshold of the day is said once, over the two messages: the 80 % one, then the cap.
    expect(crossings.map((crossing) => [crossing.kind, crossing.status.state, crossing.status.day])).toEqual([
      ['alert', 'reached', '2026-10-29'],
      ['reached', 'reached', '2026-10-29'],
    ]);
  });
});
