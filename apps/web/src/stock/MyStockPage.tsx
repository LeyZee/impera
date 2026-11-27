import type { ContentStock, DropCategory, HerDay, StockCategory } from '@impera/contracts';
import { useState, type JSX } from 'react';

import { StockCategoryView, type StockOpened } from './StockCategoryView';
import { useStock, type StockDoor } from './api';
import { HER_CATEGORIES, STOCK_COLOURS, STOCK_NAMES, fillOf, herFocusOf, ringSub, unitsOf } from './model';

import { useNow } from '@/scheduling/useNow';
import { useCreatorDay } from '@/screens/agenda/day-api';
import { useContent } from '@/screens/content/api';
import { Ring } from '@/shell/figures/figures';
import { Page, PageHeader } from '@/shell/layout';
import { Failure } from '@/shell/states';

import './stock.css';

const DOOR: StockDoor = { kind: 'self' };
/**
 * Mon coffre, the creator's (ADR 0163 § 5), made for her phone: the one thing to drop in large (her video of the day,
 * else the week's advance), two bonuses at most, then each of her categories as a ring of days of advance (7 fills it). Never red: a short stock is said, not
 * blamed. A ring opens her media of that category, each with what the AI understood, « C'est bien ça » and « Corriger ».
 */
export function MyStockPage({ onDrop }: { onDrop: (category: DropCategory) => void }): JSX.Element {
  const stock = useStock(DOOR);
  // Her day as Aujourd'hui reads it, and the scripts the agency asks: the coffre says the same (recette MOD-01, MOD-02).
  const day = useCreatorDay().data ?? null;
  const requests = useContent().data?.requests;
  const scriptsAsked =
    requests?.filter((one) => one.category === 'script' && one.state === 'open' && one.dropId === null)
      .length ?? 0;
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
  else
    body = (
      <Mine stock={stock.data} day={day} scriptsAsked={scriptsAsked} onDrop={onDrop} onOpen={setOpened} />
    );

  return (
    <Page className="st-mine" width="narrow">
      {opened === null ? <PageHeader title="Mon coffre" /> : null}
      {body}
    </Page>
  );
}

function Mine({
  stock,
  day,
  scriptsAsked,
  onDrop,
  onOpen,
}: {
  stock: ContentStock;
  day: HerDay | null;
  scriptsAsked: number;
  onDrop: (category: DropCategory) => void;
  onOpen: (opened: StockOpened) => void;
}): JSX.Element {
  const focus = herFocusOf(stock, day, scriptsAsked);
  const hers = stock.categories.filter((one) => HER_CATEGORIES.has(one.category));
  const colour = focus.category === null ? 'var(--nv-success)' : STOCK_COLOURS[focus.category];
  return (
    <div className="st-mine__body nv-swap">
      <section
        className="nv-plate nv-plate--pad st-focus"
        style={{ '--st-c': colour }}
        aria-labelledby="st-focus"
      >
        {focus.when === null ? null : <span className="nv-eyebrow">{EYEBROWS[focus.when]}</span>}
        <p id="st-focus" className="st-answer">
          {focus.title}
        </p>
        <p className="st-focus__lead">{focus.lead}</p>
        {focus.category === null ? null : (
          <button
            type="button"
            className="nv-btn nv-btn--neon st-focus__go"
            onClick={() => {
              if (focus.category !== null) onDrop(focus.category);
            }}
          >
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
                <Ring
                  share={fillOf(one) / 100}
                  label={herRingSub(one, scriptsAsked)}
                  colour={STOCK_COLOURS[one.category]}
                >
                  {ringValue(one)}
                </Ring>
                <span className="st-ring__name">{STOCK_NAMES[one.category]}</span>
                <span className="st-ring__sub nv-num">{herRingSub(one, scriptsAsked)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <p className="st-muted st-mine__foot">Tout ce que tu déposes reste à toi, rangé ici.</p>
    </div>
  );
}

const EYEBROWS = { today: 'Aujourd’hui', week: 'Pour ta semaine', stock: 'Pour ton coffre' } as const;

/** Under her ring: her scripts, none asked and none ready, wait on the agency, never on her (recette MOD-02). */
function herRingSub(category: StockCategory, scriptsAsked: number): string {
  if (category.category === 'script' && scriptsAsked === 0 && category.stockUnits === 0)
    return 'L’agence t’enverra tes scripts';
  return ringSub(category);
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
