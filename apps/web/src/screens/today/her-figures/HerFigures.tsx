import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { herFiguresOf } from './model';

import { useCreatorFanInsights } from '@/screens/sales/api';

/** Three figures of her fans under her day, and the way into Ventes for the rest. Quiet while nothing is read. */
export function HerFigures(): JSX.Element | null {
  const insights = useCreatorFanInsights().data;
  if (insights === undefined) return null;
  return (
    <section className="nv-plate sc-figures nv-enter" aria-labelledby="sc-figures-title">
      <div className="sc-figures__head">
        <h2 id="sc-figures-title" className="nv-h2 sc-fans__title">
          Tes chiffres
        </h2>
        <Link to="/ventes" className="nv-btn nv-btn--soft nv-btn--sm">
          Tout voir
        </Link>
      </div>
      <div className="sc-figures__tiles">
        {herFiguresOf(insights).map((figure) => (
          <div key={figure.key} className="nv-tile">
            <span className="nv-tile__label">{figure.label}</span>
            <span className="nv-tile__value nv-num">{figure.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
