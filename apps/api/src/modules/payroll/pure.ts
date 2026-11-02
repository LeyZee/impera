/**
 * The pure rules pay lends the modules that depend on it (ADR 0051): re-exports of `domain/` only, no code written
 * here, no I/O. Everything else goes through `index.ts`.
 */
export { periodWords, type InvoiceTotals } from './domain/invoices';
export type { StoredInvoicePdf } from './domain/ports';
export { settlementsDue, type SettlementCarryOver, type SettlementStatement } from './domain/settlements';
