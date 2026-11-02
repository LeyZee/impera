// Allowed: payroll depends on contractors, so its domain may use contractors' pure.ts.
import { contractorRule } from '../../contractors/pure';

export const usesPure = contractorRule;
