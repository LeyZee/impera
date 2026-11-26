import { LINK_PLACEMENTS } from '@impera/contracts';
import { niceTicks } from '@impera/design-system';
import { useMemo, type JSX } from 'react';

import { useLinkHours, useRedirectLinks } from './api';
import {
  changePercent,
  clicksText,
  hoursView,
  hourText,
  PLACEMENT_COLOURS,
  robotShare,
  type HoursView,
} from './hours';
import { PLACEMENT_LABELS, sameWords } from './model';

import { CountUp, useFloatingTip } from '@/screens/dashboard/parts';
import { Columns, Spark } from '@/shell/figures/figures';
import { Failure } from '@/shell/states';

import './links.css';

const formatCount = (value: number): string => Math.round(value).toLocaleString('fr-FR');

/**
 * Trafic › « Ses clics, heure par heure » (INS-02 lot e3): the answer first (her clicks over the last 24 hours against
 * the day before), then the hours stacked by place, then her linked links ranked. Only a linked link is read; robots
 * are counted apart and never in the clicks.
 */
export function LinkHours({ creatorId, now }: { creatorId: string; now?: Date }): JSX.Element {
  const hoursQuery = useLinkHours(creatorId);
  const linksQuery = useRedirectLinks(creatorId);
  const tip = useFloatingTip();
  // The hour of the last reading, so that the columns move with the data and not with each render.
  const atMs = now?.getTime() ?? hoursQuery.dataUpdatedAt;
  const view = useMemo(
    () =>
      hoursQuery.data === undefined || linksQuery.data === undefined
        ? null
        : hoursView(hoursQuery.data, linksQuery.data, new Date(atMs)),
    [hoursQuery.data, linksQuery.data, atMs],
  );

  if (view === null) {
    return hoursQuery.isError || linksQuery.isError ? (
      <Failure
        onRetry={() => {
          void hoursQuery.refetch();
          void linksQuery.refetch();
        }}
      />
    ) : (
      <div className="nv-plate ps-panel cl-loading" aria-busy="true" aria-label="Lecture de ses clics" />
    );
  }
  return (
    <div className="nv-plate ps-panel">
      <section className="ps-block" aria-labelledby="clh-title">
        <h3 className="nv-h3 ps-block__title" id="clh-title">
          Ses clics, heure par heure
        </h3>
        {view.links.length === 0 ? (
          <p className="ps-hint">
            Aucun lien relié pour l’instant. Relie un lien dans {'« Ses liens »'} : ses clics arrivent ici à
            chaque heure.
          </p>
        ) : (
          <>
            <Answer view={view} />
            <Hours view={view} tip={tip} />
            <Ranked view={view} />
          </>
        )}
      </section>
      {tip.element}
    </div>
  );
}

/** The one big figure: the clicks of the last 24 hours, the change against the day before, the robots set apart. */
function Answer({ view }: { view: HoursView }): JSX.Element {
  const change = changePercent(view.clicks, view.clicksBefore);
  const robots = robotShare(view.pageviews, view.robots);
  return (
    <div className="clh-answer">
      <div className="nv-figure">
        <span className="nv-figure__label">Clics sur 24 h</span>
        <CountUp className="nv-figure__value" value={view.clicks} format={formatCount} />
        <span className="nv-figure__note">
          {change === null ? (
            <span>Rien à comparer avec la veille</span>
          ) : (
            <>
              <span className={`nv-delta nv-delta--${change >= 0 ? 'better' : 'worse'}`}>
                {change > 0 ? '+' : change < 0 ? '−' : ''}
                {String(Math.abs(change))} %
              </span>
              <span>contre {clicksText(view.clicksBefore)} la veille</span>
            </>
          )}
        </span>
      </div>
      <dl className="clh-side">
        <div>
          <dt>Pages vues</dt>
          <dd className="nv-num">{formatCount(view.pageviews)}</dd>
        </div>
        <div data-tone={robots >= 30 ? 'warning' : undefined}>
          <dt>Robots écartés</dt>
          <dd className="nv-num">
            {formatCount(view.robots)}
            <span className="clh-side__share"> · {String(robots)} %</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** The last 24 hours, one column per hour stacked by place; the hour still running is hatched. */
function Hours({ view, tip }: { view: HoursView; tip: ReturnType<typeof useFloatingTip> }): JSX.Element {
  const max = Math.max(0, ...view.columns.map((column) => column.total));
  const ticks = niceTicks(Math.max(max, 3), 3);
  const top = ticks[ticks.length - 1] ?? 1;
  const last = view.columns.length - 1;
  return (
    <div className="clh-hours">
      {view.placements.length > 0 ? (
        <ul className="nv-keys" aria-label="Légende">
          {view.placements.map((placement) => (
            <li key={placement}>
              <span className="nv-key" style={{ '--_c': PLACEMENT_COLOURS[placement] }} aria-hidden="true" />
              {PLACEMENT_LABELS[placement]}
            </li>
          ))}
        </ul>
      ) : null}
      <Columns
        label={`Clics heure par heure sur 24 h, au plus ${clicksText(max)} : flèches pour passer d’une heure à l’autre`}
        top={top}
        ticks={ticks.map((value) => ({ value, text: formatCount(value) }))}
        columns={view.columns.map((column, i) => {
          const from = hourText(column.hour);
          const title = column.open
            ? `${from}, heure en cours`
            : `De ${from} à ${hourText(new Date(column.hour.getTime() + 3_600_000))}`;
          return {
            key: column.key,
            label: (i % 4 === 0 && last - i >= 4) || i === last ? from : '',
            says: `${title} : ${clicksText(column.total)}`,
            parts: LINK_PLACEMENTS.map((placement, p) => ({
              key: placement,
              colour: PLACEMENT_COLOURS[placement],
              value: column.clicks[p] ?? 0,
              hatched: column.open,
            })),
            handlers: tip.bind(
              {
                title,
                rows: [
                  ...LINK_PLACEMENTS.flatMap((placement, p) => {
                    const clicks = column.clicks[p] ?? 0;
                    return clicks > 0 ? [[PLACEMENT_LABELS[placement], clicksText(clicks)] as const] : [];
                  }),
                  ['Total', clicksText(column.total)],
                  ['Pages vues', formatCount(column.pageviews)],
                  ['Robots écartés', formatCount(column.robots)],
                ],
              },
              { beside: true },
            ),
          };
        })}
      />
    </div>
  );
}

/** Her linked links, the most clicked first, each with its place's colour and its small curve. */
function Ranked({ view }: { view: HoursView }): JSX.Element {
  return (
    <ol className="clh-links" aria-label="Clics par lien sur 24 h">
      {view.links.map(({ link, clicks, curve }) => (
        <li key={link.id} className="clh-link">
          <span
            className="nv-key"
            style={{
              '--_c': link.placement === null ? 'var(--nv-ink-muted)' : PLACEMENT_COLOURS[link.placement],
            }}
            aria-hidden="true"
          />
          <span className="clh-link__name">
            {link.name}
            {link.placement === null || sameWords(link.name, PLACEMENT_LABELS[link.placement]) ? null : (
              <span className="clh-link__place">{PLACEMENT_LABELS[link.placement]}</span>
            )}
          </span>
          <span className="clh-link__spark" aria-hidden="true">
            <Spark values={curve} tone="up" />
          </span>
          <span className="clh-link__clicks nv-num">{clicksText(clicks)}</span>
        </li>
      ))}
    </ol>
  );
}
