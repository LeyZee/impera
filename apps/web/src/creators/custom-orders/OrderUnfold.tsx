import type { CreatorId, FanId } from '@impera/contracts';
import { useState, type JSX } from 'react';

import { OrderCard } from './OrderCard';
import { useCustomOrders } from './api';

/**
 * Under a « Demande sur mesure » line of « À traiter » (ADR 0159, trous béants point 6): « Voir la demande » unfolds
 * his order's card, with « Elle accepte à … € » and « Elle refuse » for the owner. Her orders are read only once
 * unfolded; his is the one still before her answer.
 */
export function OrderUnfold({
  creatorId,
  fanId,
  canAnswer,
}: {
  creatorId: CreatorId;
  fanId: FanId;
  canAnswer: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const query = useCustomOrders(creatorId, 'active', open);
  const order = query.data?.find(
    (one) => one.fanId === fanId && (one.state === 'awaiting_creator' || one.state === 'gathering'),
  );
  return (
    <div className="cso-unfold">
      <button
        type="button"
        className="nv-btn nv-btn--soft nv-btn--sm cso-unfold__toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        {open ? 'Replier la demande' : 'Voir la demande'}
      </button>
      {!open ? null : query.isError ? (
        <p className="ps-error" role="alert">
          Sa demande ne se lit pas pour l’instant. Réessaie dans un instant.
        </p>
      ) : query.data === undefined ? (
        <p className="ps-muted">Chargement de sa demande…</p>
      ) : order === undefined ? (
        <p className="ps-muted">
          Sa demande a déjà reçu une réponse : elle est dans Créatrices › Sur mesure.
        </p>
      ) : (
        <OrderCard creatorId={creatorId} order={order} canAnswer={canAnswer} />
      )}
    </div>
  );
}
