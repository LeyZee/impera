import type { JSX } from 'react';

import { eur } from './logic';
import type { RevealSales, RevealSeller } from './model';
import { CountUp, type FloatingTip } from './parts';

import { initialOf } from '@/lib/utils';

const formatEur = (value: number): string => eur(value);

/** The mark of a seller who is not a member: the agent, a chatter nobody linked, no chatter at all. */
const MARK: Readonly<Record<Exclude<RevealSeller['kind'], 'member'>, string>> = {
  agent: '✦',
  unlinked: '?',
  none: '–',
};

/**
 * Level 2, once a platform's register is read (CRM-04 lot c): the period's chiffre d'affaires and how it splits, as the
 * platform gives it, then who sold for the owner and an active manager. Data colours, never the neon: a sale is no urgency.
 */
export function RevealSalesPanel({
  sales,
  creatorName,
  tip,
}: {
  sales: RevealSales;
  creatorName: string;
  tip: FloatingTip;
}): JSX.Element {
  const best = Math.max(0, ...(sales.sellers ?? []).map((seller) => seller.revenue));
  return (
    <div className="db-reveal">
      <div className="nv-plate db-reveal__figures">
        <div className="nv-figure db-reveal__lead">
          <span className="nv-figure__label">Chiffre d’affaires</span>
          <CountUp className="nv-figure__value" value={sales.revenue} format={formatEur} />
          <span className="nv-figure__note">{sales.counts}</span>
        </div>
        <dl className="db-reveal__split">
          {(
            [
              ['Net', sales.net, 'ce que l’agence et la créatrice se partagent'],
              ['Part de l’agence', sales.agency, `chiffre de ${sales.where}`],
              [`Part de ${creatorName}`, sales.creator, `chiffre de ${sales.where}`],
            ] as const
          ).map(([label, value, hint]) => (
            <div key={label} className="db-reveal__part" title={hint}>
              <dt>{label}</dt>
              <dd className={value < 0 ? 'is-negative' : undefined}>{eur(value)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {sales.sellers === null ? null : sales.sellers.length === 0 ? (
        <p className="db-pending nv-plate">Aucune vente lue chez {sales.where} sur la période.</p>
      ) : (
        <ul className="nv-plate db-fans db-reveal__sellers" aria-label="Qui a vendu">
          {sales.sellers.map((seller) => (
            <li key={seller.key} className="db-fan" data-kind={seller.kind}>
              <span className="nv-avatar" aria-hidden="true">
                {seller.kind === 'member' ? initialOf(seller.name) : MARK[seller.kind]}
              </span>
              <span className="db-fan__who">
                <span className="db-fan__name">{seller.name}</span>
                <span className="db-fan__line">{seller.line}</span>
              </span>
              {/* Every bar starts at the same place: widths are shares of the best seller's revenue. */}
              <span
                className="nv-split"
                {...tip.bind({
                  title: seller.name,
                  rows: [
                    ['Chiffre d’affaires', eur(seller.revenue)],
                    ['Net', eur(seller.net)],
                    ['Part de l’agence', eur(seller.agency)],
                    [`Part de ${creatorName}`, eur(seller.creator)],
                  ],
                })}
              >
                <i
                  className="nv-split__part"
                  style={{
                    '--nv-w': `${String(best <= 0 ? 0 : (Math.max(0, seller.revenue) / best) * 100)}%`,
                    '--_c': seller.kind === 'agent' ? 'var(--nv-data-1)' : 'var(--nv-data-2)',
                  }}
                />
              </span>
              <span className={`db-fan__spent${seller.revenue < 0 ? ' is-negative' : ''}`}>
                {eur(seller.revenue)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {sales.notes.map((note) => (
        <p key={note} className="db-fans__note">
          {note}
        </p>
      ))}
    </div>
  );
}
