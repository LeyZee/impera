import type { ConnectorSend, SendJournal } from '../../domain/ports';

/**
 * `connector_sends` in memory, for the adapter's unit and contract tests: the same rules as the table (one row per
 * key, its first start kept, Reveal's id set once). The integration tests run the real table.
 */
export class MemorySendJournal implements SendJournal {
  readonly rows = new Map<string, ConnectorSend>();

  find(key: string): Promise<ConnectorSend | null> {
    return Promise.resolve(this.rows.get(key) ?? null);
  }

  begin(send: Omit<ConnectorSend, 'platformMessageId' | 'sentAt'>): Promise<ConnectorSend> {
    const row = this.rows.get(send.idempotencyKey) ?? { ...send, platformMessageId: null, sentAt: null };
    this.rows.set(send.idempotencyKey, row);
    return Promise.resolve(row);
  }

  settle(key: string, platformMessageId: string, sentAt: Date): Promise<void> {
    const row = this.rows.get(key);
    if (row?.platformMessageId === null) {
      this.rows.set(key, { ...row, platformMessageId, sentAt });
    }
    return Promise.resolve();
  }

  ownIds(conversationId: string, ids: readonly string[]): Promise<ReadonlySet<string>> {
    const own = [...this.rows.values()]
      .filter((row) => row.platformConversationId === conversationId)
      .flatMap((row) => (row.platformMessageId === null ? [] : [row.platformMessageId]));
    return Promise.resolve(new Set(ids.filter((id) => own.includes(id))));
  }
}
