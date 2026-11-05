import type { JSX } from 'react';

/**
 * Her shooting sheet (VEI-01 lot d, ADR 0042 § 4): what the agency wants shot, as plain text, its line breaks kept and
 * never read as Markdown. Folded under its name on a proposal, where she decides before reading it all; open in the
 * task she accepted, where it is what she shoots from. She reads it and never edits it.
 */
export function ShootBrief({ brief, folded }: { brief: string; folded: boolean }): JSX.Element {
  if (!folded)
    return (
      <section className="ag-brief" aria-label="Fiche de tournage">
        <b className="ag-brief__title">🎬 Fiche de tournage</b>
        <p className="ag-brief__text">{brief}</p>
      </section>
    );
  return (
    <details className="ag-brief">
      <summary className="ag-brief__title">🎬 Fiche de tournage</summary>
      <p className="ag-brief__text">{brief}</p>
    </details>
  );
}
