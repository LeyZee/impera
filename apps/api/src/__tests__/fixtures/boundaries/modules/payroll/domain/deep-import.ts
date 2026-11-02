// Violation: another module's domain file, bypassing its pure.ts.
import { contractorRule } from '../../contractors/domain/rules';

export const deepImport = contractorRule;
