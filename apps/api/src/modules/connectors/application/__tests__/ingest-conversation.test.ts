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

    const created = await ingestConversation(connector, ingest, account, snapshot, { correlationId: 'test' });

    expect(created).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.fanDisplayName).toBe('FanNul');
    expect(seen[0]?.message.text).toBe('saluttoi');
  });
});
