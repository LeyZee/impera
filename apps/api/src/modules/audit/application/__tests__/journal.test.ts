import { AUDIT_EXPORT_MAX, UserIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { AuditPosition, AuditSelection, AuditStore, StoredAuditRow } from '../../domain/ports';
import { exportJournal, readJournalPage, type AuditJournalDeps } from '../journal';

const NORA = '0195f0c0-0000-7000-8000-0000000000b1';

function row(index: number): StoredAuditRow {
  const id = `0195f0c0-0000-7000-8000-${String(index).padStart(12, '0')}`;
  return {
    id,
    at: new Date(Date.UTC(2026, 10, 20, 10, 0, 0, index)),
    position: { at: `2026-11-20T10:00:00.${String(index).padStart(6, '0')}Z`, id },
    userId: NORA,
    authorName: 'Nora',
    action: 'bonus.create',
    entity: 'bonus',
    entityId: id,
    details: { period: '2026-11-01' },
  };
}

/** A store of `count` lines, newest first, that counts what it is asked. */
function fakeStore(count: number) {
  const rows = Array.from({ length: count }, (_, i) => row(count - i));
  const asked: { selection: AuditSelection; after: AuditPosition | null; limit: number }[] = [];
  const exported: number[] = [];
  const store: AuditStore = {
    rowsUnscoped: (selection, after, limit) => {
      asked.push({ selection, after, limit });
      const start = after === null ? 0 : rows.findIndex((r) => r.id === after.id) + 1;
      return Promise.resolve(rows.slice(start, start + limit));
    },
    namesUnscoped: () => Promise.resolve({ members: new Map([[NORA, 'Nora']]), creators: new Map() }),
    recordExportUnscoped: (_actor, n) => {
      exported.push(n);
      return Promise.resolve();
    },
  };
  return { store, asked, exported };
}

const cursor: AuditJournalDeps['cursor'] = {
  encode: (position) => JSON.stringify(position),
  decode: (value) => z.object({ at: z.string(), id: z.string() }).parse(JSON.parse(value)),
};

describe('a page of the journal (EQ-18)', () => {
  it('gives a cursor while lines remain, none on the last page', async () => {
    const { store, asked } = fakeStore(5);
    const deps = { store, cursor };
    const first = await readJournalPage(deps, { limit: 3 });
    expect(first.items.map((item) => item.label)).toEqual(
      Array(3).fill('a accordé une prime pour la quinzaine du 1er au 15 novembre 2026'),
    );
    expect(first.items[0]?.author).toEqual({ userId: NORA, name: 'Nora' });
    expect(first.nextCursor).not.toBeNull();
    const second = await readJournalPage(deps, { limit: 3, cursor: first.nextCursor ?? '' });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    // One more line asked than the page holds: that is how the last page knows it is the last.
    expect(asked.map((a) => a.limit)).toEqual([4, 4]);
    expect(asked[1]?.after?.id).toBe(first.items[2]?.id);
  });

  it('passes the selection, the period read as instants', async () => {
    const { store, asked } = fakeStore(1);
    await readJournalPage(
      { store, cursor },
      {
        limit: 10,
        category: 'money',
        userId: UserIdSchema.parse(NORA),
        from: '2026-11-01T00:00:00+01:00',
        to: '2026-12-01T00:00:00Z',
      },
    );
    expect(asked[0]?.selection).toEqual({
      category: 'money',
      userId: NORA,
      from: new Date('2026-10-31T23:00:00.000Z'),
      to: new Date('2026-12-01T00:00:00.000Z'),
    });
  });
});

describe('the export of the journal (EQ-18)', () => {
  it('exports every line of the selection, then writes its own line', async () => {
    const { store, exported } = fakeStore(7);
    const file = await exportJournal({ store, cursor }, {}, { userId: NORA, ip: '203.0.113.9' });
    expect(file.split('\r\n').filter((line) => line !== '')).toHaveLength(8);
    expect(exported).toEqual([7]);
  });

  it('refuses a selection wider than one export, and writes nothing', async () => {
    const { store, exported } = fakeStore(AUDIT_EXPORT_MAX + 1);
    await expect(
      exportJournal({ store, cursor }, {}, { userId: NORA, ip: '203.0.113.9' }),
    ).rejects.toMatchObject({
      code: 'audit_export_unprocessable',
      details: { max: AUDIT_EXPORT_MAX },
    });
    expect(exported).toEqual([]);
  });
});
