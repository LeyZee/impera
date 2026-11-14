import { ConnectorConfigSchema, CreatorIdSchema, newId, PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { ConnectorAccount, IngestMessage } from '../../domain/ports';
import { FakeConnector } from '../../infra/fake/FakeConnector';
import { ingestConversation } from '../ingest-conversation';

const account: ConnectorAccount = {
  id: newId(PlatformAccountIdSchema),
  creatorId: newId(CreatorIdSchema),
  platform: 'reveal',
  sessionState: 'valid',
  lastPollAt: null,
  config: ConnectorConfigSchema.parse({}),
  consecutiveErrors: 0,
  pausedUntil: null,
};

describe('ingestConversation', () => {
  // Recette 05/11, MOT-01: one U+0000 in a fan's text or name made the insert fail, then the worker.
  it('drops U+0000 from the text and the fan name before they reach the core', async () => {
    const connector = new FakeConnector();
    connector.enqueueInbound({
      conversationId: 'c1',
      fanId: 'f1',
      fanDisplayName: 'Fan\u0000Nul',
      text: 'salut\u0000toi',
    });
    const seen: Parameters<IngestMessage>[0][] = [];
    const ingest: IngestMessage = (input) => {
      seen.push(input);
      return Promise.resolve({ isNew: true });
    };
    const [snapshot] = await connector.listConversations({});
    if (snapshot === undefined) throw new Error('no conversation');

    const created = await ingestConversation(connector, ingest, account, snapshot, {
      correlationId: 'test',
      catchUp: false,
    });

    expect(created).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.fanDisplayName).toBe('FanNul');
    expect(seen[0]?.message.text).toBe('saluttoi');
  });

  // P2-02: a caught-up message is stored without setting off a read or an answer of the models.
  it('marks every message caught up on a first poll, and an old one only afterwards', async () => {
    let now = new Date('2026-11-12T08:00:00Z');
    const connector = new FakeConnector({ now: () => now });
    connector.enqueueInbound({ conversationId: 'c1', fanId: 'f1', fanDisplayName: 'Fan', text: 'hier soir' });
    now = new Date('2026-11-12T20:00:00Z');
    connector.enqueueInbound({
      conversationId: 'c1',
      fanId: 'f1',
      fanDisplayName: 'Fan',
      text: 'à l’instant',
    });
    const [snapshot] = await connector.listConversations({});
    if (snapshot === undefined) throw new Error('no conversation');
    const read = async (catchUp: boolean | Date) => {
      const seen: Parameters<IngestMessage>[0][] = [];
      await ingestConversation(
        connector,
        (input) => {
          seen.push(input);
          return Promise.resolve({ isNew: true });
        },
        account,
        snapshot,
        { correlationId: 'test', catchUp },
      );
      return seen.map((input) => [input.message.text, input.catchUp]);
    };

    expect(await read(true)).toEqual([
      ['hier soir', true],
      ['à l’instant', true],
    ]);
    expect(await read(new Date('2026-11-12T14:00:00Z'))).toEqual([
      ['hier soir', true],
      ['à l’instant', false],
    ]);
  });
});
