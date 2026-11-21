import type { CreatorId, CustomOrderView } from '@impera/contracts';
import { useState, type JSX } from 'react';

import { useCustomPrices } from '../custom-prices/api';
import { lineName } from '../custom-prices/model';

import { OrderCard } from './OrderCard';
import { CUSTOM_ORDERS_ERRORS, customOrdersErrorKind, useCustomOrders, type CustomOrdersScope } from './api';
import { STATE_TONES } from './model';
import './custom-orders.css';

/**
 * Créatrices › Sur mesure › « Commandes en cours » (ADR 0159 § A, trous béants point 6): her custom orders up to
 * « livrée », the one waiting on her answer first. The owner answers and moves each step; an active manager who
 * follows her reads them. « Toutes » shows the delivered and closed ones too.
 */
export function CustomOrdersSection({
  creatorId,
  creatorName,
  canAnswer,
}: {
  creatorId: CreatorId;
  creatorName: string;
  canAnswer: boolean;
}): JSX.Element {
  const [scope, setScope] = useState<CustomOrdersScope>('active');
  const query = useCustomOrders(creatorId, scope);
  // Her grid names the supplements: the owner's alone to read.
  const grid = useCustomPrices(creatorId, canAnswer);
  const supplementName = (id: string): string | null =>
    grid.data === undefined ? null : lineName(grid.data.grid, id);
  const orders = query.data === undefined ? [] : sorted(query.data);
  const waiting = orders.filter((order) => order.state === 'awaiting_creator').length;

  return (
    <section className="cso-section" aria-labelledby="cso-title">
      <header className="cso-head">
        <div>
          <p className="nv-eyebrow cso-head__eyebrow">Commandes en cours</p>
          {/* The answer first, in large (Design): what waits on her, or that nothing does. */}
          <h2 className="nv-h2 cso-head__title" id="cso-title">
            {headline(query.data, scope, waiting, creatorName)}
          </h2>
        </div>
        <div className="cso-scope" role="group" aria-label="Quelles commandes">
          {(
            [
              ['active', 'En cours'],
              ['all', 'Toutes'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="nv-chip"
              aria-pressed={scope === value}
              onClick={() => {
                setScope(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      {query.isError ? (
        <p className="ps-error" role="alert">
          {CUSTOM_ORDERS_ERRORS[customOrdersErrorKind(query.error)]}
        </p>
      ) : query.data === undefined ? (
        <p className="ps-muted">Chargement des commandes…</p>
      ) : orders.length === 0 ? (
        <div className="nv-calm">
          <span className="nv-dot nv-tone--ok" aria-hidden="true" />
          {scope === 'active' ? 'Aucune commande en cours.' : 'Aucune commande pour l’instant.'}
        </div>
      ) : (
        <ul className="cso-list">
          {orders.map((order, i) => (
            <li key={order.id} style={{ '--nv-i': i }}>
              <OrderCard
                creatorId={creatorId}
                order={order}
                canAnswer={canAnswer}
                supplementName={supplementName}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What waits on her first, then what runs, then the rest; the latest first inside each. */
function sorted(orders: readonly CustomOrderView[]): CustomOrderView[] {
  const rank = { warn: 0, info: 1, ok: 2, muted: 3 } as const;
  return orders.toSorted(
    (a, b) =>
      rank[STATE_TONES[a.state]] - rank[STATE_TONES[b.state]] ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

/** The heading: what waits on her answer, or how many orders move along. */
function headline(
  orders: readonly CustomOrderView[] | undefined,
  scope: CustomOrdersScope,
  waiting: number,
  creatorName: string,
): string {
  if (orders === undefined) return 'Commandes sur mesure';
  if (waiting === 1) return `1 demande attend la réponse de ${creatorName}`;
  if (waiting > 1) return `${String(waiting)} demandes attendent la réponse de ${creatorName}`;
  const moving = orders.filter((order) => STATE_TONES[order.state] === 'info').length;
  if (moving > 0)
    return `Rien n’attend, ${moving === 1 ? '1 commande avance' : `${String(moving)} commandes avancent`}`;
  return scope === 'active' ? 'Aucune commande en cours' : 'Aucune commande pour l’instant';
}
