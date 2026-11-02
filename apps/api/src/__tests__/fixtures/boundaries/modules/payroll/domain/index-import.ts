// Violation: a domain never imports another module's index.ts, only its pure.ts.
import { contractorsIndex } from '../../contractors';

export const indexImport = contractorsIndex;
