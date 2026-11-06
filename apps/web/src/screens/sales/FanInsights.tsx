import type { CreatorFanInsights } from '@impera/contracts';
import { countUp } from '@impera/design-system';
import { useLayoutEffect, useRef, useState, type JSX } from 'react';

import { useCreatorFanInsights } from './api';
import {
  AGE_LABELS,
  aboutLine,
  arcsOf,
  caseColour,
  DAYS,
  DAYS_SHORT,
  heatOf,
  JOB_LABELS,
  PLACE_LABELS,
  SITUATION_LABELS,
  slotLabel,
  TIER_LABELS,
} from './insights-view';
import './insights.css';

import { ServerSilent } from '@/shell/ServerSilent';
import { Panel, PanelSection } from '@/shell/layout';

/*
 * « Qui sont tes fans » (CR-15, ADR 0065 § 2, ADR 0074 § 8): in front of Ventes, figures on all her fans, never one.
 * Rings and bars that draw in, a case lit on hover, focus or touch, its share in the middle of the ring. The server
 * sends shares only: no case says how many fans it holds, and a block under ten fans says so in words.
 */

interface Case {
  readonly key: string;
  readonly share: number;
}

const TOO_FEW = 'Pas encore assez de fans pour le dire.';

function Count({ value, format = String }: { value: number; format?: (n: number) => string }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const from = shown.current;
    shown.current = value;
    return countUp(element, value, (n) => format(Math.round(n)), { from, durationMs: 900 });
  }, [value, format]);
  return <span ref={ref} />;
}

const percent = (n: number) => `${String(n)}\u00a0%`;

/** A ring of cases and its legend; the lit case shows in the middle, the legend lights with it. */
function RingCard({
  title,
  cases,
  labels,
  aboutFans,
  idle,
  index,
}: {
  title: string;
  cases: readonly Case[];
  labels: Readonly<Record<string, string>>;
  aboutFans: number;
  /** What the middle says when nothing is lit: the first case, or the average age. */
  idle?: { readonly value: string; readonly sub: string };
  index: number;
}): JSX.Element {
  const [lit, setLit] = useState<number | null>(null);
  const radius = 52;
  const arcs = arcsOf(
    cases.map((c) => c.share),
    radius,
  );
  const first = cases[0];
  const shown = lit === null ? null : cases[lit];
  const label = (key: string) => labels[key] ?? key;
  return (
    <article className="fi-card nv-enter" style={{ '--nv-i': index }}>
      <h3 className="fi-card__title">{title}</h3>
      <div className="fi-ring-row">
        <div
          className={lit === null ? 'fi-ring' : 'fi-ring is-lit'}
          role="img"
          aria-label={`${title} : ${cases.map((c) => `${label(c.key)} ${percent(c.share)}`).join(', ')}`}
        >
          <svg viewBox="0 0 132 132" aria-hidden="true">
            <circle className="fi-ring__track" cx="66" cy="66" r={radius} />
            {cases.map((c, i) => {
              const arc = arcs[i];
              if (arc === undefined || c.share === 0) return null;
              return (
                <circle
                  key={c.key}
                  className={lit === i ? 'fi-ring__arc is-on' : 'fi-ring__arc'}
                  cx="66"
                  cy="66"
                  r={radius}
                  style={{
                    '--_c': caseColour(c.key, i),
                    '--_dash': arc.dash,
                    '--_i': i,
                  }}
                  strokeDashoffset={arc.offset}
                  onPointerEnter={() => {
                    setLit(i);
                  }}
                  onPointerLeave={(event) => {
                    if (event.pointerType === 'mouse') setLit(null);
                  }}
                />
              );
            })}
          </svg>
          <span className="fi-ring__middle" aria-hidden="true">
            {shown !== null && shown !== undefined ? (
              <>
                <b className="fi-ring__value">{percent(shown.share)}</b>
                <span className="fi-ring__sub">{label(shown.key)}</span>
              </>
            ) : idle !== undefined ? (
              <>
                <b className="fi-ring__value">{idle.value}</b>
                <span className="fi-ring__sub">{idle.sub}</span>
              </>
            ) : first !== undefined ? (
              <>
                <b className="fi-ring__value">
                  <Count value={first.share} format={percent} />
                </b>
                <span className="fi-ring__sub">{label(first.key)}</span>
              </>
            ) : null}
          </span>
        </div>
        <ul className="fi-legend">
          {cases.map((c, i) => (
            <li key={c.key}>
              <button
                type="button"
                className={lit === i ? 'fi-legend__row is-on' : 'fi-legend__row'}
                style={{ '--_c': caseColour(c.key, i) }}
                aria-pressed={lit === i}
                onPointerEnter={() => {
                  setLit(i);
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType === 'mouse') setLit(null);
                }}
                onFocus={() => {
                  setLit(i);
                }}
                onBlur={() => {
                  setLit(null);
                }}
                onClick={() => {
                  setLit(i);
                }}
              >
                <i className="fi-legend__key" aria-hidden="true" />
                <span className="fi-legend__name">{label(c.key)}</span>
                <b className="fi-legend__share">{percent(c.share)}</b>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="fi-card__foot">{aboutLine(aboutFans)}</p>
    </article>
  );
}

/** Bars, for the jobs: long names read better on a line than around a ring. */
function BarsCard({
  title,
  cases,
  labels,
  aboutFans,
  index,
}: {
  title: string;
  cases: readonly Case[];
  labels: Readonly<Record<string, string>>;
  aboutFans: number;
  index: number;
}): JSX.Element {
  const [lit, setLit] = useState<number | null>(null);
  const top = Math.max(1, ...cases.map((c) => c.share));
  return (
    <article className="fi-card nv-enter" style={{ '--nv-i': index }}>
      <h3 className="fi-card__title">{title}</h3>
      <ul className={lit === null ? 'fi-bars' : 'fi-bars is-lit'}>
        {cases.map((c, i) => (
          <li key={c.key}>
            <button
              type="button"
              className={lit === i ? 'fi-bar is-on' : 'fi-bar'}
              style={{
                '--_c': caseColour(c.key, i),
                '--_w': `${String((c.share / top) * 100)}%`,
                '--_i': i,
              }}
              aria-pressed={lit === i}
              onPointerEnter={() => {
                setLit(i);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === 'mouse') setLit(null);
              }}
              onFocus={() => {
                setLit(i);
              }}
              onBlur={() => {
                setLit(null);
              }}
              onClick={() => {
                setLit(i);
              }}
            >
              <span className="fi-bar__head">
                <span className="fi-bar__name">{labels[c.key] ?? c.key}</span>
                <b className="fi-bar__share">{percent(c.share)}</b>
              </span>
              <span className="fi-bar__track" aria-hidden="true">
                <span className="fi-bar__fill" />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="fi-card__foot">{aboutLine(aboutFans)}</p>
    </article>
  );
}

function EmptyCard({ title, index }: { title: string; index: number }): JSX.Element {
  return (
    <article className="fi-card fi-card--empty nv-enter" style={{ '--nv-i': index }}>
      <h3 className="fi-card__title">{title}</h3>
      <div className="fi-ring-row">
        <div className="fi-ring fi-ring--empty" aria-hidden="true">
          <svg viewBox="0 0 132 132">
            <circle className="fi-ring__track" cx="66" cy="66" r={52} />
          </svg>
        </div>
        <p className="fi-empty">{TOO_FEW}</p>
      </div>
    </article>
  );
}

function SpendingCard({
  spending,
  index,
}: {
  spending: Extract<CreatorFanInsights['spending'], { status: 'enough' }>;
  index: number;
}): JSX.Element {
  const euros = (minor: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(
      minor / 100,
    );
  const radius = 52;
  const [arc] = arcsOf([spending.payingShare, 100 - spending.payingShare], radius, 0);
  return (
    <article className="fi-card fi-card--wide nv-enter" style={{ '--nv-i': index }}>
      <h3 className="fi-card__title">Ce qu’ils débloquent</h3>
      <div className="fi-spend">
        <div className="fi-spend__lead">
          <div
            className="fi-ring fi-ring--solo"
            role="img"
            aria-label={`${percent(spending.payingShare)} de tes fans ont déjà débloqué un message`}
          >
            <svg viewBox="0 0 132 132" aria-hidden="true">
              <circle className="fi-ring__track" cx="66" cy="66" r={radius} />
              {arc === undefined || spending.payingShare === 0 ? null : (
                <circle
                  className="fi-ring__arc"
                  cx="66"
                  cy="66"
                  r={radius}
                  style={{ '--_c': 'var(--nv-sale)', '--_dash': arc.dash, '--_i': 0 }}
                  strokeDashoffset={arc.offset}
                />
              )}
            </svg>
            <span className="fi-ring__middle" aria-hidden="true">
              <b className="fi-ring__value">
                <Count value={spending.payingShare} format={percent} />
              </b>
              <span className="fi-ring__sub">ont déjà débloqué</span>
            </span>
          </div>
          <div className="fi-basket">
            <span className="fi-basket__label">Panier moyen sur 30 jours</span>
            {spending.averageBasketMinor === null ? (
              <span className="fi-basket__none">Pas encore assez de fans payants pour le dire.</span>
            ) : (
              <b className="fi-basket__value">
                <Count value={spending.averageBasketMinor} format={euros} />
              </b>
            )}
            <span className="fi-basket__note">Par fan qui a payé, TVA comprise, avant parts.</span>
          </div>
        </div>
        <BarsInline cases={spending.cases} labels={TIER_LABELS} />
      </div>
    </article>
  );
}

function BarsInline({
  cases,
  labels,
}: {
  cases: readonly Case[];
  labels: Readonly<Record<string, string>>;
}): JSX.Element {
  const [lit, setLit] = useState<number | null>(null);
  const top = Math.max(1, ...cases.map((c) => c.share));
  return (
    <ul className={lit === null ? 'fi-bars' : 'fi-bars is-lit'}>
      {cases.map((c, i) => (
        <li key={c.key}>
          <button
            type="button"
            className={lit === i ? 'fi-bar is-on' : 'fi-bar'}
            style={{
              '--_c': c.key === 'none' ? 'var(--nv-ink-faint)' : 'var(--nv-sale)',
              '--_w': `${String((c.share / top) * 100)}%`,
              '--_i': i,
            }}
            aria-pressed={lit === i}
            onPointerEnter={() => {
              setLit(i);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === 'mouse') setLit(null);
            }}
            onFocus={() => {
              setLit(i);
            }}
            onBlur={() => {
              setLit(null);
            }}
            onClick={() => {
              setLit(i);
            }}
          >
            <span className="fi-bar__head">
              <span className="fi-bar__name">{labels[c.key] ?? c.key}</span>
              <b className="fi-bar__share">{percent(c.share)}</b>
            </span>
            <span className="fi-bar__track" aria-hidden="true">
              <span className="fi-bar__fill" />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ActivityCard({
  cells,
  index,
}: {
  cells: Extract<CreatorFanInsights['activity'], { status: 'enough' }>['cells'];
  index: number;
}): JSX.Element {
  const [lit, setLit] = useState<{ day: number; slot: number; share: number } | null>(null);
  const busiest = Math.max(0, ...cells.map((c) => c.share));
  const peak = cells.reduce<(typeof cells)[number] | null>(
    (best, c) => (best === null || c.share > best.share ? c : best),
    null,
  );
  const say = (c: { day: number; slot: number }) => `${DAYS[c.day] ?? ''}, ${slotLabel(c.slot)}`;
  return (
    <article className="fi-card fi-card--full nv-enter" style={{ '--nv-i': index }}>
      <h3 className="fi-card__title">Quand ils t’écrivent</h3>
      <p className="fi-heat__line" aria-live="polite">
        {lit === null ? (
          peak === null ? null : (
            <>
              Le plus souvent : <b>{say(peak)}</b>
            </>
          )
        ) : (
          <>
            {say(lit)} : <b>{percent(lit.share)}</b> de leurs messages
          </>
        )}
      </p>
      <div
        className="fi-heat"
        role="group"
        aria-label="Leurs messages des 30 derniers jours, par jour et par tranche de trois heures"
      >
        <span aria-hidden="true" />
        {Array.from({ length: 8 }, (_, slot) => (
          <span key={`h${String(slot)}`} className="fi-heat__hour" aria-hidden="true">
            {slot % 2 === 0 ? `${String(slot * 3)}h` : ''}
          </span>
        ))}
        {DAYS_SHORT.map((day, d) => (
          <div key={day} className="fi-heat__row" style={{ display: 'contents' }}>
            <span className="fi-heat__day" aria-hidden="true">
              {day}
            </span>
            {Array.from({ length: 8 }, (_, slot) => {
              const cell = cells.find((c) => c.day === d && c.slot === slot) ?? { day: d, slot, share: 0 };
              const on = lit !== null && lit.day === d && lit.slot === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  className={on ? 'fi-heat__cell is-on' : 'fi-heat__cell'}
                  style={{
                    '--_h': heatOf(cell.share, busiest),
                    '--_i': d * 8 + slot,
                  }}
                  aria-label={`${say(cell)} : ${percent(cell.share)}`}
                  aria-pressed={on}
                  onPointerEnter={() => {
                    setLit(cell);
                  }}
                  onPointerLeave={(event) => {
                    if (event.pointerType === 'mouse') setLit(null);
                  }}
                  onFocus={() => {
                    setLit(cell);
                  }}
                  onBlur={() => {
                    setLit(null);
                  }}
                  onClick={() => {
                    setLit(cell);
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <p className="fi-card__foot">Leurs messages des 30 derniers jours, dans ton heure.</p>
    </article>
  );
}

/** A count rounded to ten by the server, or « moins de 10 » under the threshold: never an exact count (ADR 0074 § 8). */
function Stat({ value, label }: { value: number | null; label: string }): JSX.Element {
  return (
    <div className="fi-stat">
      <b className="fi-stat__value">
        {value === null ? (
          <span className="fi-stat__few">moins de 10</span>
        ) : (
          <>
            <span className="fi-stat__about" aria-hidden="true">
              ≈
            </span>
            <span className="sr-only">environ </span>
            <Count value={value} />
          </>
        )}
      </b>
      <span className="fi-stat__label">{label}</span>
    </div>
  );
}

/** The panel: three numbers, then a card per question, each one honest when it has too few fans. */
export function FanInsights(): JSX.Element {
  const insights = useCreatorFanInsights();
  if (insights.isError && insights.data === undefined)
    return (
      <ServerSilent
        text="Les chiffres de tes fans n’ont pas pu être lus."
        onRetry={() => {
          void insights.refetch();
        }}
      />
    );
  if (insights.data === undefined)
    return (
      <Panel className="fi-panel">
        <PanelSection>
          <div className="fi-skeleton" aria-busy="true" aria-label="Chargement des chiffres de tes fans">
            <i />
            <i />
            <i />
          </div>
        </PanelSection>
      </Panel>
    );
  const data = insights.data;
  const age = data.age;
  return (
    <Panel
      className="fi-panel nv-enter"
      eyebrow="Sur l’ensemble de tes fans, jamais un seul"
      title={
        <>
          Qui sont <em className="fi-serif">tes fans</em>
        </>
      }
    >
      <PanelSection>
        <div className="fi-stats">
          <Stat value={data.fans.total} label="fans en tout" />
          <Stat value={data.fans.newLast30Days} label="nouveaux sur 30 jours" />
          <Stat value={data.fans.wroteLast7Days} label="t’ont écrit cette semaine" />
        </div>
        <div className="fi-grid">
          {age.status === 'enough' ? (
            <RingCard
              title="Leur âge"
              cases={age.cases}
              labels={AGE_LABELS}
              aboutFans={age.aboutFans}
              idle={{ value: `${String(age.averageAge)}\u00a0ans`, sub: 'en moyenne' }}
              index={0}
            />
          ) : (
            <EmptyCard title="Leur âge" index={0} />
          )}
          {data.place.status === 'enough' ? (
            <RingCard
              title="D’où ils t’écrivent"
              cases={data.place.cases}
              labels={PLACE_LABELS}
              aboutFans={data.place.aboutFans}
              index={1}
            />
          ) : (
            <EmptyCard title="D’où ils t’écrivent" index={1} />
          )}
          {data.situation.status === 'enough' ? (
            <RingCard
              title="Leur situation"
              cases={data.situation.cases}
              labels={SITUATION_LABELS}
              aboutFans={data.situation.aboutFans}
              index={2}
            />
          ) : (
            <EmptyCard title="Leur situation" index={2} />
          )}
          {data.job.status === 'enough' ? (
            <BarsCard
              title="Leur métier"
              cases={data.job.cases}
              labels={JOB_LABELS}
              aboutFans={data.job.aboutFans}
              index={3}
            />
          ) : (
            <EmptyCard title="Leur métier" index={3} />
          )}
          {data.spending.status === 'enough' ? (
            <SpendingCard spending={data.spending} index={4} />
          ) : (
            <EmptyCard title="Ce qu’ils débloquent" index={4} />
          )}
          {data.activity.status === 'enough' ? (
            <ActivityCard cells={data.activity.cells} index={5} />
          ) : (
            <EmptyCard title="Quand ils t’écrivent" index={5} />
          )}
        </div>
        <p className="fi-note">
          Ce que tes fans ont dit eux-mêmes en conversation, arrêté chaque nuit à minuit. Une case ne
          s’affiche qu’à partir de dix fans, pour qu’aucun ne s’y reconnaisse.
        </p>
      </PanelSection>
    </Panel>
  );
}
