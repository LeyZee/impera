import type { ReelBrief as ReelSheet } from '@impera/contracts';
import type { JSX } from 'react';

import { ReelBrief } from './ReelBrief';

/**
 * Her shooting sheet (VEI-01 lot d, ADR 0042 § 4): what the agency wants shot, as plain text, its line breaks kept and
 * never read as Markdown; for a Reel, its drawn reel sheet first (ADR 0082 § 3), the text under it. Folded under its
 * name on a proposal, where she decides before reading it all; open in the task she accepted, where it is what she
 * shoots from. She reads it and never edits it. Without a reel sheet, it shows exactly as before.
 */
export function ShootBrief({
  brief,
  reel = null,
  folded,
}: {
  brief: string | null;
  reel?: ReelSheet | null;
  folded: boolean;
}): JSX.Element {
  const content = (
    <>
      {reel === null ? null : <ReelBrief brief={reel} />}
      {brief === null ? null : reel === null ? (
        <p className="ag-brief__text">{brief}</p>
      ) : (
        // Beside a reel sheet, the free text is what is left to know: said so, under its own title.
        <section className="ag-brief__more" aria-label="À savoir aussi">
          <span className="ag-brief__more-title">À savoir aussi</span>
          <p className="ag-brief__text">{brief}</p>
        </section>
      )}
    </>
  );
  if (!folded)
    return (
      <section className="ag-brief" aria-label="Fiche de tournage">
        <b className="ag-brief__title">🎬 Fiche de tournage</b>
        {content}
      </section>
    );
  return (
    <details className="ag-brief">
      <summary className="ag-brief__title">🎬 Fiche de tournage</summary>
      {content}
    </details>
  );
}
