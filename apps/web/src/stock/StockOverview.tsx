import type { ContentStock, CreatorId, StockCategory } from '@impera/contracts';
import { ringDash } from '@impera/design-system';
import { useState, type JSX } from 'react';

import { StockCategoryView, type StockOpened } from './StockCategoryView';
import { useStock, type StockDoor } from './api';
import {
  PLATFORM_NAMES,
  STOCK_COLOURS,
  STOCK_NAMES,
  STOCK_RULES,
  STOCK_USES,
  daysLabel,
  droppedByDay,
  figuresOf,
  fillOf,
  headlineOf,
  mediaCountOf,
  paceOf,
  platformsOf,
  unitsOf,
} from './model';

import { useNow } from '@/scheduling/useNow';
import { Donut, Spark, useLit } from '@/shell/figures/figures';
import { Failure } from '@/shell/states';

import './stock.css';

const RING_RADIUS = 27;

/**
 * Coffre Impera, the agency's view (ADR 0162): Créatrices › Médias for the owner and an active manager. The answer
 * first (the platform that runs dry first, what is missing most), four figures, the days of advance by use against
 * their target, what is inside, then one card per category, grouped by where it goes out; a card opens her media.
 */
export function StockSection({
  creatorId,
  creatorName,
}: {
  creatorId: CreatorId;
  creatorName: string;
}): JSX.Element {
  const door: StockDoor = { kind: 'team', creatorId };
  const stock = useStock(door);
  const now = useNow();
  const [opened, setOpened] = useState<StockOpened | null>(null);

  if (stock.data === undefined) {
    if (stock.isError)
      return (
        <Failure
          title={`Le coffre de ${creatorName} ne se charge pas.`}
          onRetry={() => void stock.refetch()}
        />
      );
    return <div className="st-page ps-skeleton ps-skeleton--tall" aria-busy="true" />;
  }
  if (opened !== null)
    return (
      <div className="st-page">
        <StockCategoryView
          door={door}
          stock={stock.data}
          opened={opened}
          audience="team"
          now={now}
          onBack={() => {
            setOpened(null);
          }}
        />
      </div>
    );
  return <Overview stock={stock.data} creatorName={creatorName} now={now} onOpen={setOpened} />;
}

function Overview({
  stock,
  creatorName,
  now,
  onOpen,
}: {
  stock: ContentStock;
  creatorName: string;
  now: Date;
  onOpen: (opened: StockOpened) => void;
}): JSX.Element {
  const headline = headlineOf(stock, now);
  const figures = figuresOf(stock, now);
  const platforms = platformsOf(stock);
  const opened = new Set(
    platforms.filter((one) => one.open).flatMap((one) => one.categories.map((c) => c.category)),
  );
  const paced = stock.categories.filter((one) => one.mode === 'days' && opened.has(one.category));
  const change = figures.dropped14 - figures.droppedBefore;

  return (
    <div className="st-page nv-swap" aria-label={`Coffre Impera de ${creatorName}`} role="region">
      <header className="nv-plate nv-plate--pad st-hero" data-tone={headline.tone}>
        <span className="nv-eyebrow">Coffre Impera</span>
        <p className="st-answer">{headline.title}</p>
        <p className="st-hero__lead">{headline.lead}</p>
        {figures.toValidate === 0 ? null : (
          <div className="st-hero__actions">
            <button
              type="button"
              className="nv-btn nv-btn--sm nv-btn--soft"
              onClick={() => {
                onOpen({ kind: 'to_validate' });
              }}
            >
              Relire les {figures.toValidate} descriptions
            </button>
          </div>
        )}
      </header>

      <div className="st-tiles">
        <div className="nv-tile st-tile-figure">
          <span className="nv-tile__label">En stock</span>
          <span className="nv-tile__value nv-num">{figures.inStock} médias</span>
          <span className="nv-tile__sub">
            {figures.scripts === 0
              ? 'aucun dans un script'
              : `dont ${String(figures.scripts)} dans des scripts`}
          </span>
        </div>
        <div className="nv-tile st-tile-figure st-tile-figure--spark">
          <span className="nv-tile__label">Déposés sur 14 jours</span>
          <span className="nv-tile__value nv-num">{figures.dropped14}</span>
          <span className={`nv-delta ${change >= 0 ? 'nv-delta--better' : 'nv-delta--worse'}`}>
            {change >= 0 ? '+' : '−'}
            {Math.abs(change)} face aux 14 j d’avant
          </span>
          <Spark values={droppedByDay(stock, now)} tone={change >= 0 ? 'up' : 'down'} />
        </div>
        <div className="nv-tile st-tile-figure">
          <span className="nv-tile__label">Partis cette semaine</span>
          <span className="nv-tile__value nv-num">{figures.out7}</span>
          <span className="nv-tile__sub">marqués « Publié » par l’équipe</span>
        </div>
        <button
          type="button"
          className="nv-tile st-tile-figure st-tile-figure--open"
          data-tone={figures.toValidate > 0 ? 'warn' : undefined}
          disabled={figures.toValidate === 0}
          onClick={() => {
            onOpen({ kind: 'to_validate' });
          }}
        >
          <span className="nv-tile__label">Descriptions à valider</span>
          <span className="nv-tile__value nv-num">{figures.toValidate}</span>
          <span className="nv-tile__sub">
            {figures.failed === 0
              ? 'toutes écrites par l’IA'
              : `et ${String(figures.failed)} que l’IA n’a pas su décrire`}
          </span>
        </button>
      </div>

      <div className="st-duo">
        <section className="nv-plate nv-plate--pad st-days" aria-labelledby="st-days-title">
          <h3 id="st-days-title" className="nv-h3">
            Jours d’avance par usage
          </h3>
          <p className="st-muted">Le trait marque l’objectif : 7 jours sur Reveal, 3 sur Instagram.</p>
          <ul className="st-bars">
            {paced.map((one) => (
              <li key={one.category}>
                <button
                  type="button"
                  className="st-bar"
                  style={{ '--st-c': STOCK_COLOURS[one.category] }}
                  onClick={() => {
                    onOpen({ kind: 'category', category: one.category });
                  }}
                >
                  <span className="st-bar__name">{STOCK_NAMES[one.category]}</span>
                  <span
                    className="st-bar__track"
                    style={{
                      '--st-fill': `${String(Math.min(100, ((one.daysAhead ?? 0) / 14) * 100))}%`,
                      '--st-mark': `${String(((one.target ?? 0) / 14) * 100)}%`,
                    }}
                    aria-hidden="true"
                  >
                    <span className="st-bar__fill" />
                    <span className="st-bar__mark" />
                  </span>
                  <span className="st-bar__days nv-num" data-status={one.status}>
                    {daysLabel(one.daysAhead ?? 0)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <Inside stock={stock} />
      </div>

      {platforms.map((platform) =>
        platform.categories.length === 0 ? null : (
          <section
            key={platform.platform}
            className="st-platform"
            data-open={platform.open}
            aria-labelledby={`st-p-${platform.platform}`}
          >
            <header className="st-platform__head">
              <h3 id={`st-p-${platform.platform}`} className="nv-h3">
                {PLATFORM_NAMES[platform.platform]}
              </h3>
              <span className="st-muted nv-num">
                {!platform.open
                  ? `pas encore ouvert à ${creatorName} : ses tuiles arrivent avec le branchement`
                  : platform.days === null
                    ? 'en bonus'
                    : platform.days >= 14
                      ? 'tient plus de deux semaines'
                      : `tient ${daysLabel(platform.days)}`}
              </span>
            </header>
            <div className="st-cards">
              {platform.categories.map((one) => (
                <CategoryCard
                  key={one.category}
                  category={one}
                  media={mediaCountOf(stock, one.category).all}
                  awaited={platform.open}
                  onOpen={() => {
                    onOpen({ kind: 'category', category: one.category });
                  }}
                />
              ))}
            </div>
            {platform.platform === 'reveal' ? (
              <p className="st-wall">
                Cloison : rien de ce qui est au-dessus ne part vers Instagram. Le code le refuse, même si
                quelqu’un se trompe de catégorie.
              </p>
            ) : null}
          </section>
        ),
      )}
    </div>
  );
}

/** What is inside: a donut of the media in stock by category, its legend lighting each slice. */
function Inside({ stock }: { stock: ContentStock }): JSX.Element {
  const { lit, setLit, row } = useLit();
  const slices = stock.categories
    .map((one) => ({
      key: one.category,
      label: STOCK_NAMES[one.category],
      colour: STOCK_COLOURS[one.category],
      value: mediaCountOf(stock, one.category).inStock,
    }))
    .filter((one) => one.value > 0);
  const total = slices.reduce((sum, one) => sum + one.value, 0);
  const shown = lit === null ? undefined : slices[lit];
  return (
    <section className="nv-plate nv-plate--pad st-inside" aria-labelledby="st-inside-title">
      <h3 id="st-inside-title" className="nv-h3">
        Ce qu’il y a dedans
      </h3>
      {total === 0 ? (
        <p className="st-muted">Rien en stock pour l’instant.</p>
      ) : (
        <div className="nv-donut-row">
          <Donut label="Médias en stock par catégorie" slices={slices} lit={lit} onLit={setLit}>
            <b className="nv-donut__value nv-num">{shown === undefined ? total : shown.value}</b>
            <span className="nv-donut__sub">{shown === undefined ? 'médias' : shown.label}</span>
          </Donut>
          <ul className="nv-breakdown">
            {slices.map((one, index) => (
              <li key={one.key}>
                <button
                  type="button"
                  className={lit === index ? 'nv-breakdown__row is-on' : 'nv-breakdown__row'}
                  {...row(index)}
                >
                  <span className="nv-key" style={{ '--_c': one.colour }} aria-hidden="true" />
                  <span className="nv-breakdown__label">{one.label}</span>
                  <span className="nv-breakdown__value nv-num">{one.value}</span>
                  <span className="nv-breakdown__share nv-num">
                    {Math.round((one.value / total) * 100)}&nbsp;%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function CategoryCard({
  category,
  media,
  awaited,
  onOpen,
}: {
  category: StockCategory;
  /** Every medium the category view will list, gone ones included. */
  media: number;
  /** False while her platform is not open: nothing is expected, nothing is lacking. */
  awaited: boolean;
  onOpen: () => void;
}): JSX.Element {
  const fill = fillOf(category);
  const rule = STOCK_RULES[category.category];
  const centre =
    category.mode === 'days'
      ? daysLabel(category.daysAhead ?? 0).replace(' +', '+')
      : category.mode === 'count'
        ? `${String(category.stockUnits)}/${String(category.target ?? 0)}`
        : '+';
  return (
    <article
      className="nv-plate nv-plate--pad st-card"
      style={{ '--st-c': STOCK_COLOURS[category.category] }}
      data-status={category.status}
      aria-labelledby={`st-c-${category.category}`}
    >
      <header className="st-card__head">
        <div className="nv-ring st-card__ring" role="img" aria-label={`${String(fill)} % de l’objectif`}>
          <svg viewBox="0 0 66 66" aria-hidden="true">
            <circle className="nv-ring__track" cx="33" cy="33" r={RING_RADIUS} />
            <circle
              className="nv-ring__value"
              cx="33"
              cy="33"
              r={RING_RADIUS}
              strokeDasharray={ringDash(fill / 100, RING_RADIUS)}
            />
          </svg>
          <span className="nv-ring__label nv-num" aria-hidden="true">
            {centre}
          </span>
        </div>
        <div className="st-card__titles">
          <h4 id={`st-c-${category.category}`} className="st-card__name">
            {STOCK_NAMES[category.category]}
          </h4>
          <span className="st-card__pace">{paceOf(category)}</span>
        </div>
      </header>
      <p className="st-card__use">{STOCK_USES[category.category]}</p>
      {rule === undefined ? null : <span className="st-rule">{rule}</span>}
      <dl className="st-card__facts">
        <div>
          <dt>En stock</dt>
          <dd className="nv-num">{unitsOf(category.category, category.stockUnits)}</dd>
        </div>
        <div>
          <dt>Parti en 7 j</dt>
          <dd className="nv-num">{category.outUnits7}</dd>
        </div>
        <div>
          <dt>Manque</dt>
          <dd className="nv-num" data-tone={awaited && category.lacking > 0 ? 'warn' : undefined}>
            {!awaited || category.lacking === 0 ? 'Rien' : category.lacking}
          </dd>
        </div>
      </dl>
      <button type="button" className="nv-btn nv-btn--sm nv-btn--plain st-card__open" onClick={onOpen}>
        Ouvrir {media === 0 ? 'la catégorie' : `les ${String(media)} médias`} →
      </button>
    </article>
  );
}
