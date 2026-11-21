import type { ContentStock, DropCategory, StockMedium } from '@impera/contracts';
import { useMemo, useState, type JSX, type KeyboardEvent } from 'react';

import { StockViewer } from './StockViewer';
import { stockThumbnailUrl, type StockDoor } from './api';
import {
  DESCRIPTION_LABELS,
  FILTER_LABELS,
  STANDING_LABELS,
  STOCK_COLOURS,
  STOCK_FILTERS,
  STOCK_NAMES,
  STOCK_RULES,
  STOCK_USES,
  droppedOnLabel,
  durationLabel,
  filtered,
  groupsOf,
  type StockFilter,
} from './model';

import { Meter } from '@/shell/figures/figures';
import { Empty } from '@/shell/states';

/** What a view of media shows: one category, or every description that waits for a look. */
export type StockOpened =
  { readonly kind: 'category'; readonly category: DropCategory } | { readonly kind: 'to_validate' };

const WEEK = 7 * 86_400_000;

/**
 * One category of her coffre, or every description to validate (ADR 0162 § 4): its figures, a filter, then her media
 * grouped by drop (a boudoir session stays together) with where each stands and its description's state; a tap
 * opens it in large.
 */
export function StockCategoryView({
  door,
  stock,
  opened,
  audience,
  now,
  onBack,
}: {
  door: StockDoor;
  stock: ContentStock;
  opened: StockOpened;
  audience: 'team' | 'her';
  now: Date;
  onBack: () => void;
}): JSX.Element {
  const [filter, setFilter] = useState<StockFilter>(opened.kind === 'to_validate' ? 'to_validate' : 'all');
  const [viewing, setViewing] = useState<number | null>(null);
  const all = useMemo(
    () =>
      opened.kind === 'category'
        ? stock.media.filter((one) => one.category === opened.category)
        : stock.media.filter((one) => one.description === 'to_validate'),
    [stock.media, opened],
  );
  const shown = filtered(all, filter);
  const groups = groupsOf(shown);
  const flat = groups.flatMap((group) => group.media);
  const offsets = groups.map((_, at) => groups.slice(0, at).reduce((sum, one) => sum + one.media.length, 0));
  const category = opened.kind === 'category' ? opened.category : null;
  const colour = category === null ? 'var(--nv-warning)' : STOCK_COLOURS[category];
  const her = audience === 'her';
  const erasing = all.filter(
    (one) => one.erasesAt !== null && Date.parse(one.erasesAt) - now.getTime() < WEEK,
  ).length;
  const figures: readonly (readonly [string, number, StockFilter | null])[] = [
    ['En stock', all.filter((one) => one.standing === 'stock').length, 'stock'],
    ['Programmés', all.filter((one) => one.standing === 'scheduled').length, 'scheduled'],
    [
      'Partis en 7 j',
      all.filter((one) => one.outAt !== null && now.getTime() - Date.parse(one.outAt) < WEEK).length,
      'out',
    ],
    ['À valider', all.filter((one) => one.description === 'to_validate').length, 'to_validate'],
    ...(her ? [] : [['Effacé sous 7 j', erasing, null] as const]),
  ];
  const rule = category === null ? undefined : STOCK_RULES[category];

  return (
    <section className="st-cat nv-swap" style={{ '--st-c': colour }} aria-labelledby="st-cat-title">
      <button type="button" className="nv-btn nv-btn--sm nv-btn--plain st-back" onClick={onBack}>
        ← {her ? 'Mon coffre' : 'Coffre Impera'}
      </button>
      <header className="st-cat__head">
        <span className="st-cat__swatch" aria-hidden="true" />
        <div className="st-cat__titles">
          <h2 id="st-cat-title" className="nv-h2">
            {category === null ? 'Descriptions à valider' : STOCK_NAMES[category]}
          </h2>
          <p className="st-cat__use">
            {category === null
              ? 'Ce que l’IA a écrit et que personne n’a encore relu. Les chatteurs et l’IA de chatting lisent ces textes.'
              : STOCK_USES[category]}
            {rule === undefined ? null : <span className="st-rule">{rule}</span>}
          </p>
        </div>
      </header>

      <div className="st-figures" role="list">
        {figures.map(([label, value, target]) => (
          <button
            key={label}
            type="button"
            role="listitem"
            className="nv-tile st-figure"
            data-on={target !== null && filter === target}
            data-tone={label === 'À valider' && value > 0 && !her ? 'warn' : undefined}
            disabled={target === null}
            onClick={() => {
              if (target !== null) setFilter(filter === target ? 'all' : target);
            }}
          >
            <span className="nv-tile__label">{label}</span>
            <span className="nv-tile__value nv-num">{value}</span>
          </button>
        ))}
      </div>

      <FilterBar value={filter} onChange={setFilter} />

      {groups.length === 0 ? (
        <Empty title={filter === 'all' ? 'Rien ici pour l’instant.' : 'Rien sous ce filtre.'}>
          {filter === 'all'
            ? her
              ? 'Ce que tu déposes dans Contenu arrive ici.'
              : 'Ce qu’elle dépose dans Contenu arrive ici.'
            : 'Choisis « Tout » pour revoir chaque média.'}
        </Empty>
      ) : (
        <div className="st-groups">
          {groups.map((group, at) => {
            const offset = offsets[at] ?? 0;
            const total = all.filter((one) => one.dropId === group.dropId).length;
            const out = all.filter((one) => one.dropId === group.dropId && one.standing === 'out').length;
            return (
              <section
                key={group.dropId}
                className="st-group"
                aria-label={`Dépôt du ${droppedOnLabel(group.droppedAt)}`}
              >
                <header className="st-group__head">
                  <span className="st-group__name">
                    {category === null ? STOCK_NAMES[group.media[0]?.category ?? 'feed_shoot'] : 'Dépôt'} du{' '}
                    {droppedOnLabel(group.droppedAt)}
                  </span>
                  <span className="st-group__sub nv-num">
                    {total} {total > 1 ? 'médias' : 'média'} · {out} {out > 1 ? 'sortis' : 'sorti'}
                  </span>
                  <span className="st-group__meter">
                    <Meter percent={total === 0 ? 0 : (out / total) * 100} colour="var(--st-c)" />
                  </span>
                </header>
                <ul className="st-grid">
                  {group.media.map((medium, position) => (
                    <Tile
                      key={medium.fileId}
                      door={door}
                      medium={medium}
                      onOpen={() => {
                        setViewing(offset + position);
                      }}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <div className="st-key" aria-hidden="true">
        <span className="st-key__item" data-desc="validated">
          {DESCRIPTION_LABELS.validated}
        </span>
        <span className="st-key__item" data-desc="to_validate">
          {DESCRIPTION_LABELS.to_validate}
        </span>
        <span className="st-key__item" data-desc="pending">
          {DESCRIPTION_LABELS.pending}
        </span>
      </div>

      {viewing === null ? null : (
        <StockViewer
          door={door}
          media={flat}
          index={viewing}
          audience={audience}
          onIndex={setViewing}
          onClose={() => {
            setViewing(null);
          }}
        />
      )}
    </section>
  );
}

function FilterBar({
  value,
  onChange,
}: {
  value: StockFilter;
  onChange: (next: StockFilter) => void;
}): JSX.Element {
  const index = STOCK_FILTERS.indexOf(value);
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = STOCK_FILTERS[(index + step + STOCK_FILTERS.length) % STOCK_FILTERS.length];
    if (next !== undefined) onChange(next);
  };
  return (
    <div
      className="nv-seg nv-glass nv-glass--thin st-filter"
      role="radiogroup"
      aria-label="Filtrer les médias"
      style={{ '--nv-seg-count': STOCK_FILTERS.length, '--nv-seg-index': index }}
      onKeyDown={onKeyDown}
    >
      <span className="nv-seg__thumb nv-glass nv-glass--thin" aria-hidden="true" />
      {STOCK_FILTERS.map((one) => (
        <button
          key={one}
          type="button"
          role="radio"
          className="nv-seg__opt"
          aria-checked={one === value}
          tabIndex={one === value ? 0 : -1}
          onClick={() => {
            onChange(one);
          }}
        >
          {FILTER_LABELS[one]}
        </button>
      ))}
    </div>
  );
}

function Tile({
  door,
  medium,
  onOpen,
}: {
  door: StockDoor;
  medium: StockMedium;
  onOpen: () => void;
}): JSX.Element {
  const [broken, setBroken] = useState(false);
  const length = durationLabel(medium.durationMs);
  const kind = medium.kind === 'video' ? 'Vidéo' : medium.kind === 'audio' ? 'Vocal' : 'Photo';
  return (
    <li className="st-tile" data-standing={medium.standing}>
      <button
        type="button"
        className="st-tile__open"
        aria-label={`${kind}, ${STANDING_LABELS[medium.standing]}, ${DESCRIPTION_LABELS[medium.description]} : ouvrir en grand`}
        onClick={onOpen}
      >
        {broken || medium.kind === 'audio' ? (
          <span className="st-tile__blank" aria-hidden="true" />
        ) : (
          <img
            className="st-tile__img nv-blurrable"
            src={stockThumbnailUrl(door, medium.dropId, medium.fileId)}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => {
              setBroken(true);
            }}
          />
        )}
        <span className="st-tile__chip">{STANDING_LABELS[medium.standing]}</span>
        <span className="st-tile__dot" data-desc={medium.description} aria-hidden="true" />
        {medium.kind === 'image' ? null : <span className="st-tile__kind nv-num">{length ?? kind}</span>}
        {medium.notAGift ? <span className="st-tile__flag">Trop dénudé pour un cadeau</span> : null}
      </button>
    </li>
  );
}
