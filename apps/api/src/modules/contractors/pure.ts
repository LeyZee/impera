/**
 * The pure rules the contractors' file lends the modules that depend on it (ADR 0051): re-exports of `domain/` only,
 * no code written here, no I/O. Everything else goes through `index.ts`.
 */
export {
  addDays,
  documentState,
  documentValidUntil,
  identityComplete,
  newestOf,
  regimeOn,
  taxResidenceOf,
  treatyNeedsResidence,
  type BillingRegime,
  type ContractorDocument,
  type ContractorIdentity,
  type RegimeAssignment,
} from './domain/billing';
export { PayrollForbidden, TeamMemberNotFound } from './domain/errors';
export type { Actor, JobLogger } from './domain/ports';
export { invoicePdfRetainUntil } from './domain/retention';
