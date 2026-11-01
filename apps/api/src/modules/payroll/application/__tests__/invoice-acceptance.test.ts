import { InvoiceIdSchema, newId, type InvoiceId } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import type { PayrollInvoiceAcceptanceStore } from '../../domain/ports';
import { sweepInvoiceAcceptance } from '../invoice-acceptance';

const quiet = { warn: () => undefined, error: () => undefined };
const unexpected = (): never => {
  throw new Error('not called by the sweep');
};

/** A store whose documents are due as given; `failing` throws on its step, as a database refusing would. */
function storeWith(
  unanswered: readonly InvoiceId[],
  unannounced: readonly InvoiceId[],
  failing: ReadonlySet<InvoiceId> = new Set(),
): PayrollInvoiceAcceptanceStore & { readonly calls: string[] } {
  const calls: string[] = [];
  const step = <T>(name: string, invoiceId: InvoiceId, outcome: T): T => {
    calls.push(`${name}:${invoiceId}`);
    if (failing.has(invoiceId)) throw new Error('database unavailable');
    return outcome;
  };
  return {
    calls,
    read: unexpected,
    answer: unexpected,
    refuseContest: unexpected,
    dueUnscoped: (limit) => {
      expect(limit).toBe(200);
      return Promise.resolve({ unanswered, unannounced });
    },
    // An answer may come between the reading and the step: `answered` counts for nothing.
    lapseUnscoped: (invoiceId) =>
      Promise.resolve(step('lapse', invoiceId, invoiceId === unanswered[1] ? 'answered' : 'lapsed')),
    announceContestUnscoped: (invoiceId) => Promise.resolve(step('announce', invoiceId, 'published')),
  };
}

describe('the hourly sweep of the invoices’ acceptance (EQ-06 lot 6, ADR 0039)', () => {
  const a = newId(InvoiceIdSchema);
  const b = newId(InvoiceIdSchema);
  const c = newId(InvoiceIdSchema);
  const d = newId(InvoiceIdSchema);

  it('accepts tacitly what is unanswered after its deadline and says each open contest without its alert', async () => {
    const store = storeWith([a, b], [c]);
    expect(await sweepInvoiceAcceptance(store, quiet)).toEqual({ lapsed: 1, announced: 1, failed: 0 });
    expect(store.calls).toEqual([`lapse:${a}`, `lapse:${b}`, `announce:${c}`]);
  });

  it('logs a document that fails and goes on with the others', async () => {
    const errors: unknown[] = [];
    const store = storeWith([a, b, d], [c], new Set([a]));
    const outcome = await sweepInvoiceAcceptance(store, {
      warn: () => undefined,
      error: (object) => errors.push(object),
    });
    expect(outcome).toEqual({ lapsed: 1, announced: 1, failed: 1 });
    expect(store.calls).toEqual([`lapse:${a}`, `lapse:${b}`, `lapse:${d}`, `announce:${c}`]);
    expect(errors).toEqual([expect.objectContaining({ invoiceId: a })]);
  });

  it('does nothing when nothing is due', async () => {
    const store = storeWith([], []);
    expect(await sweepInvoiceAcceptance(store, quiet)).toEqual({ lapsed: 0, announced: 0, failed: 0 });
    expect(store.calls).toEqual([]);
  });
});
