import type { SaleClaimShift } from '@impera/contracts';
import type { JSX } from 'react';

import { claimShiftParts } from '@/payroll/sale-claims';

/** A claimed shift on its card: its creator and account, then its day and hours, which never break (Design, #1026). */
export function ShiftLine({ shift, zone }: { shift: SaleClaimShift; zone: string }): JSX.Element {
  const { when, where } = claimShiftParts(shift, zone);
  return (
    <p className="py-member__line nv-num">
      {where} · <span className="py-claims__when">{when}</span>
    </p>
  );
}
