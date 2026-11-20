import type { InvoiceList, InvoiceListItem } from '@impera/contracts';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';

import { Empty, Loading, Unreachable } from './parts';

import { gapText, yearRange, yearSlices } from '@/invoices/model';
import { InvoiceArt } from '@/shell/art/EmptyArt';
import { Failure } from '@/shell/states';

/**
 * One's documents read a year at a time (Commissions › Factures, a member in Paie › Factures): the documents, the
 * spans without one said in days, and « Plus anciennes » up to the ten years an invoice is kept. A span without a
 * document never reads as « none at all »: what lies before it stays one click away.
 */
export function InvoiceYears({
  years,
  today,
  what,
  hint,
  first,
  older,
  none,
  since = null,
  row,
}: {
  years: UseInfiniteQueryResult<InfiniteData<InvoiceList, number>>;
  today: string | null;
  /** « la liste de tes factures »: what a server that does not answer did not give. */
  what: string;
  /** How a document comes, said under a first year without one, before « Plus anciennes » reads further. */
  hint: string;
  /** Said when ten years hold no document. */
  first: string;
  /** Said when a later year could not be read: what is missing, and what to do. */
  older: string;
  /**
   * Said instead when the latest year, the only one read, holds no document: a sentence for the reader, not how
   * « Plus anciennes » reads (CHA-18). Once he reads further, the years without a document are said by their days.
   */
  none?: { readonly whisper: string; readonly text: string; readonly action?: ReactNode };
  /**
   * The day the reader joined the team, when known: once the years read reach it, nothing lies before it, and
   * « Plus anciennes » goes (recette visuelle 16/11, CHA-18).
   */
  since?: string | null;
  row: (item: InvoiceListItem) => JSX.Element;
}): JSX.Element {
  if (years.isError && years.data === undefined)
    return (
      <Unreachable
        what={what}
        onRetry={() => {
          void years.refetch();
        }}
      />
    );
  if (years.data === undefined || today === null) return <Loading rows={3} />;

  const slices = yearSlices(today, years.data.pages, years.data.pageParams);
  const only = slices.length === 1 ? slices[0] : undefined;
  const oldest = yearRange(today, years.data.pageParams.at(-1) ?? 0).from;
  const further = years.hasNextPage && (since === null || oldest > since);
  let index = 0;

  return (
    <div className="rp-sec">
      {only?.kind === 'gap' && none !== undefined && (years.data.pages.length === 1 || !further) ? (
        <Empty whisper={none.whisper} text={none.text} action={none.action} art={<InvoiceArt />} />
      ) : only?.kind === 'gap' ? (
        <Empty
          whisper={gapText(only.range)}
          text={
            further ? `${hint} « Plus anciennes » remonte d’une année à la fois, jusqu’à dix ans.` : first
          }
        />
      ) : (
        <ul className="iv-list">
          {slices.map((slice) =>
            slice.kind === 'gap' ? (
              <li key={`gap-${slice.range.to}`} className="iv-gap">
                <p className="py-quiet">{gapText(slice.range)}</p>
              </li>
            ) : (
              slice.items.map((item) => (
                <li key={item.id} className="nv-enter" style={{ '--nv-i': Math.min(index++, 8) }}>
                  {row(item)}
                </li>
              ))
            ),
          )}
        </ul>
      )}
      {further ? (
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm iv-more"
          disabled={years.isFetchingNextPage}
          aria-busy={years.isFetchingNextPage}
          onClick={() => {
            void years.fetchNextPage();
          }}
        >
          {years.isFetchingNextPage ? 'Lecture…' : 'Plus anciennes'}
        </button>
      ) : null}
      {years.isError ? (
        <Failure
          inline
          onRetry={() => {
            void years.fetchNextPage();
          }}
        >
          {older}
        </Failure>
      ) : null}
    </div>
  );
}
