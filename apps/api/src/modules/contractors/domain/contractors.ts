import type { ContractorProfileBody } from '@impera/contracts';

/** What the contractor or the owner writes of a file: every field is identity, whose change clears the owner's check. */
export const CONTRACTOR_PROFILE_FIELDS = [
  'legalName',
  'address',
  'taxId',
  'businessId',
  'vatNumber',
  'individualEntrepreneur',
  'legalForm',
  'shareCapitalMinor',
  'rcsCity',
  'email',
] as const satisfies readonly (keyof ContractorProfileBody)[];

/** An unwritten field: what a file holds before its first write. */
const isEmpty = (value: ContractorProfileBody[keyof ContractorProfileBody]): boolean =>
  value === null || value === false;

/**
 * The names of the fields `body` changes, in their order; against `null` (no file yet), those it fills. The audit log
 * keeps who changed which field of whose file, never a copy of the values (an address, a tax id are personal data).
 */
export function profileChanges(
  before: ContractorProfileBody | null,
  body: ContractorProfileBody,
): (typeof CONTRACTOR_PROFILE_FIELDS)[number][] {
  return CONTRACTOR_PROFILE_FIELDS.filter((field) =>
    before === null ? !isEmpty(body[field]) : before[field] !== body[field],
  );
}
