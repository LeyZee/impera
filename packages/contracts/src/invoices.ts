/**
 * Contractors' invoices (EQ-06, ADR 0023 § Factures, ADR 0036): what the base keeps of a self-billed invoice, its
 * credit notes, the regime it copies, the contractor's file and the texts he accepts. An issued invoice never changes:
 * every party, mention and line is copied into it at its issue. Each file below has one job; this index re-exports
 * them, and `invoices-internal.ts` (their shared helpers) stays out of the contracts' API.
 */
export * from './billing-settings';
export * from './contractor-file';
export * from './contractor-file-api';
export * from './invoices-accounting';
export * from './invoices-api';
export * from './invoices-documents';
export * from './invoices-errors';
export * from './invoices-fields';
export * from './invoices-parties';
export * from './invoices-vocabulary';
