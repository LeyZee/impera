import { createAccountingModule, type AccountingModule } from '../modules/accounting';
import type { InvoicingModule } from '../modules/invoicing';
import type { SchedulingModule } from '../modules/scheduling';

import type { Routes, Shared } from './shared';

export interface WiredAccounting {
  readonly module: AccountingModule;
  readonly routes: readonly Routes[];
}

/**
 * The accountant's exports read the agency's time zone from the planning and each archived PDF through the invoices
 * (`checkedPdf`), both from their `index.ts` (ADR 0047 § 1). No job.
 */
export function wireAccounting(
  shared: Shared,
  deps: { readonly scheduling: SchedulingModule; readonly invoicing: InvoicingModule },
): WiredAccounting {
  const module = createAccountingModule({
    db: shared.db,
    reads: { agencyTimeZone: deps.scheduling.pay.agencyTimeZone },
    pdfs: deps.invoicing.checkedPdf,
  });
  return { module, routes: [module.routes(shared.requireRole)] };
}
