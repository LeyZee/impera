import type { ContentStock, StockCategory } from '@impera/contracts';
import { useState, type JSX } from 'react';

import { StockCategoryView, type StockOpened } from './StockCategoryView';
import { useStock, type StockDoor } from './api';
import { HER_CATEGORIES, STOCK_COLOURS, STOCK_NAMES, fillOf, herFocusOf, ringSub, unitsOf } from './model';

import { useNow } from '@/scheduling/useNow';
import { Ring } from '@/shell/figures/figures';
import { Page, PageHeader } from '@/shell/layout';
import { Failure } from '@/shell/states';

import './stock.css';

const DOOR: StockDoor = { kind: 'self' };
/**
 * Mon coffre, the creator's (ADR 0163 § 5), made for her phone: the one thing to drop today in large, two bonuses at
 * most, then each of her categories as a ring of days of advance (7 fills it). Never red: a short stock is said, not
 * blamed. A ring opens her media of that category, each with what the AI understood, « C'est bien ça » and « Corriger ».
 */
export function MyStockPage({ onDrop }: { onDrop: () => void }): JSX.Element {
  const stock = useStock(DOOR);
  const now = useNow();
  const [opened, setOpened] = useState<StockOpened | null>(null);

  let body: JSX.Element;
  if (stock.data === undefined)
    body = stock.isError ? (
      <Failure title="Ton coffre ne se charge pas." onRetry={() => void stock.refetch()} />
    ) : (
      <div className="ps-skeleton ps-skeleton--tall" aria-busy="true" />
    );
  else if (opened !== null)
    body = (
      <StockCategoryView
        door={DOOR}
        stock={stock.data}
        opened={opened}
        audience="her"
        now={now}
        onBack={() => {
          setOpened(null);
        }}
      />
    );
  else body = <Mine stock={stock.data} onDrop={onDrop} onOpen={setOpened} />;

  return (
    <Page className="st-mine" width="narrow">
      {opened === null ? <PageHeader title="Mon coffre" /> : null}
      {body}
    </Page>
  );
}

function Mine({
  stock,
  onDrop,
  onOpen,
}: {
  stock: ContentStock;
  onDrop: () => void;
  onOpen: (opened: StockOpened) => void;
}): JSX.Element {
  const focus = herFocusOf(stock);
  const hers = stock.categories.filter((one) => HER_CATEGORIES.has(one.category));
  const colour = focus.category === null ? 'var(--nv-success)' : STOCK_COLOURS[focus.category];
  return (
    <div className="st-mine__body nv-swap">
      <section
        className="nv-plate nv-plate--pad st-focus"
        style={{ '--st-c': colour }}
        aria-labelledby="st-focus"
      >
        <span className="nv-eyebrow">Aujourd’hui</span>
        <p id="st-focus" className="st-answer">
          {focus.title}
        </p>
        <p className="st-focus__lead">{focus.lead}</p>
        {focus.category === null ? null : (
          <button type="button" className="nv-btn nv-btn--neon st-focus__go" onClick={onDrop}>
            Déposer
          </button>
        )}
      </section>

      {focus.bonus.length === 0 ? null : (
        <section className="st-bonus" aria-labelledby="st-bonus">
          <h3 id="st-bonus" className="nv-h3">
            En bonus, si tu as le temps
          </h3>
          <ul className="st-bonus__list">
            {focus.bonus.map((one) => (
              <li
                key={one.category}
                className="st-bonus__item"
                style={{ '--st-c': STOCK_COLOURS[one.category] }}
              >
                <span className="st-bonus__dot" aria-hidden="true" />
                <span className="st-bonus__name">{STOCK_NAMES[one.category]}</span>
                <span className="st-bonus__sub nv-num">{bonusLine(one)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="st-rings">
        <h3 id="st-rings" className="nv-h3">
          Ce que tu as d’avance
        </h3>
        <ul className="st-rings">
          {hers.map((one) => (
            <li key={one.category}>
              <button
                type="button"
                className="st-ring"
                style={{ '--st-c': STOCK_COLOURS[one.category] }}
                onClick={() => {
                  onOpen({ kind: 'category', category: one.category });
                }}
              >
                <Ring share={fillOf(one) / 100} label={ringSub(one)} colour={STOCK_COLOURS[one.category]}>
                  {ringValue(one)}
                </Ring>
                <span className="st-ring__name">{STOCK_NAMES[one.category]}</span>
                <span className="st-ring__sub nv-num">{ringSub(one)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <p className="st-muted st-mine__foot">Tout ce que tu déposes reste à toi, rangé ici.</p>
    </div>
  );
}

/** A ring's middle: its days of advance (« 14+ » past two weeks), or how many are ready. */
function ringValue(category: StockCategory): string {
  if (category.mode !== 'days') return String(category.stockUnits);
  const days = Math.floor(category.daysAhead ?? 0);
  return days >= 14 ? '14+' : `${String(days)} j`;
}

function bonusLine(category: StockCategory): string {
  return category.mode === 'days'
    ? `de l’avance pour la semaine : ${unitsOf(category.category, category.lacking)}`
    : `encore ${unitsOf(category.category, category.lacking)}`;
}
