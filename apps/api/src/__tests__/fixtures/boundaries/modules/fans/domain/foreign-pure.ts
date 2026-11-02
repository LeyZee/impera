// Violation: fans does not depend on contractors (MODULE_DEPENDENCIES), even through its pure.ts.
import { contractorRule } from '../../contractors/pure';

export const foreignPure = contractorRule;
