import type { AiCredits, AiUsage } from '@impera/contracts';
import { niceTicks, placeSegmentThumb } from '@impera/design-system';
import { useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { CreditDialog, EntriesList } from './CreditDialog';
import { useAiUsage } from './api';
import {
  axisEur,
  capNote,
  capShare,
  countText,
  CREDIT_BADGE,
  CREDIT_TONE,
  creditText,
  dayColumns,
  eurText,
  hourColumns,
  modelSlices,
  PROVIDERS,
  providerLabel,
  refusedText,
  runwayShare,
  runwayText,
  shareOf,
  sinceText,
  USAGE_HINT,
  useSlices,
  type Column,
  type Slice,
} from './view';
import '@/screens/dashboard/dashboard.css';
import '@/screens/dashboard/agency/agency.css';
import './ai-usage.css';

import { arcs, OTHER } from '@/screens/dashboard/agency/view';
import { CountUp, Section, useFloatingTip, type FloatingTip } from '@/screens/dashboard/parts';
import { ServerSilent } from '@/shell/ServerSilent';

/*
 * Réglages › Consommation IA (ADR 0091): what the AI costs, live, and when to recharge. Every figure is the server's,
 * read in the journal of calls; the credits are the ledger the owner keeps, counted down call by call. No call to a
 * provider from this screen.
 */

const STEPS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
const formatEur = (eur: number): string => eurText(eur);

/** The day's spend against the cap: the figure that stops the agent, and how much room is left. */
function Today({ usage, now }: { usage: AiUsage; now: Date }): JSX.Element {
  const { today, pace } = usage;
  const share = capShare(usage);
  const alertShare = Math.min(100, (today.alertAtEur / today.capEur) * 100);
  return (
    <div className="ins-figures">
      <div className="nv-plate ins-lead cia-today nv-enter" style={{ '--nv-i': 1 }} data-state={today.state}>
        <div className="nv-figure">
          <span className="nv-figure__label cia-live">
            <span className="cia-live__dot" aria-hidden="true" />
            Aujourd’hui, en direct
          </span>
          <CountUp className="nv-figure__value ins-lead__value" value={today.eur} format={formatEur} />
          <span className="nv-figure__note">
            {`${countText(today.calls)} appel${today.calls > 1 ? 's' : ''}`}
            {today.failed > 0 ? `, dont ${countText(today.failed)} en erreur` : ''} ·{' '}
            {sinceText(usage.lastCallAt, now, usage.timeZone)}
          </span>
        </div>
        <div className="cia-gauge">
          <div
            className="cia-gauge__track"
            role="meter"
            aria-label="Dépense du jour face au plafond"
            aria-valuemin={0}
            aria-valuemax={today.capEur}
            aria-valuenow={Math.round(today.eur * 100) / 100}
            aria-valuetext={`${eurText(today.eur)} sur ${eurText(today.capEur)}`}
          >
            <span className="cia-gauge__fill" style={{ '--_w': `${String(share)}%` }} />
            <span
              className="cia-gauge__mark"
              style={{ '--_x': `${String(alertShare)}%` }}
              aria-hidden="true"
            />
          </div>
          <div className="cia-gauge__scale" aria-hidden="true">
            <span>0 €</span>
            <span>plafond {eurText(today.capEur)}</span>
          </div>
          <p className="cia-gauge__note">{capNote(usage)}</p>
        </div>
      </div>
      <dl className="ins-tiles cia-tiles">
        {(
          [
            {
              label: 'Ce mois-ci',
              value: eurText(pace.monthEur),
              note: `depuis le 1er, aujourd’hui compris`,
            },
            {
              label: 'Prévu fin du mois',
              value: pace.monthForecastEur === null ? '—' : eurText(pace.monthForecastEur),
              note:
                pace.monthForecastEur === null
                  ? 'après une première journée complète'
                  : 'au rythme des derniers jours',
            },
            {
              label: 'Par jour en moyenne',
              value: pace.perDayEur === null ? '—' : eurText(pace.perDayEur),
              note:
                pace.perDayEur === null
                  ? 'après une première journée complète'
                  : `sur les ${String(pace.perDayOver)} dernier${pace.perDayOver > 1 ? 's' : ''} jour${pace.perDayOver > 1 ? 's' : ''} complet${pace.perDayOver > 1 ? 's' : ''}`,
            },
          ] as const
        ).map((tile, i) => (
          <div key={tile.label} className="nv-plate ins-tile nv-enter" style={{ '--nv-i': i + 2 }}>
            <dt>{tile.label}</dt>
            <dd>
              <span className="ins-tile__value">{tile.value}</span>
            </dd>
            <dd className="ins-tile__note">{tile.note}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The card's small print: the pace and what was spent since the line it counts from. */
function creditDetail(card: AiCredits): string {
  const spent = creditText(card.spentSinceMinor, card.currency);
  if (card.mode === 'subscription')
    return `${spent} de valeur consommée depuis le passage à l’abonnement, à titre indicatif · quota visible dans ${USAGE_HINT[card.provider]}`;
  return card.perDayMinor === null || card.perDayMinor === 0
    ? `${spent} dépensés depuis la dernière saisie`
    : `${creditText(card.perDayMinor, card.currency)} par jour en moyenne · ${spent} dépensés depuis la dernière saisie`;
}

/** One provider's credits: what is left, how long it lasts, until when, and the lines it is counted from. */
function CreditCard({ card, index }: { card: AiCredits; index: number }): JSX.Element {
  const tone = CREDIT_TONE[card.state];
  const [open, setOpen] = useState(false);
  return (
    <article className="nv-plate cia-credit nv-enter" style={{ '--nv-i': index }} data-tone={tone}>
      <header className="cia-credit__head">
        <h3 className="cia-credit__name">{providerLabel(card.provider)}</h3>
        <span className={`cia-badge cia-badge--${tone}`}>{CREDIT_BADGE[card.state]}</span>
      </header>
      {card.mode === 'subscription' ? (
        <p className="cia-credit__balance cia-credit__balance--plan">
          {card.state === 'quota_reached' ? 'Quota de l’abonnement épuisé' : 'Inclus dans l’abonnement'}
        </p>
      ) : (
        <p className="cia-credit__balance nv-num">
          {creditText(card.balanceMinor, card.currency)}
          <span className="cia-credit__unit">restants</span>
        </p>
      )}
      <div className="cia-runway" aria-hidden="true">
        <span className="cia-runway__fill" style={{ '--_w': `${String(runwayShare(card))}%` }} />
      </div>
      <p className="cia-credit__runway">{runwayText(card)}</p>
      {card.mode === 'credits' && card.quotaRefusedAt !== null ? (
        <p className="cia-credit__runway cia-credit__refused">
          Le service refuse les appels faute de crédits depuis {refusedText(card.quotaRefusedAt)} : l’agent
          répond avec son modèle de repli.
        </p>
      ) : null}
      <p className="cia-credit__detail">{creditDetail(card)}</p>
      <button
        type="button"
        className="nv-btn nv-btn--plain nv-btn--sm cia-credit__more"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {open ? 'Masquer les saisies' : `Voir les saisies (${String(card.entries.length)})`}
      </button>
      {open ? <EntriesList card={card} /> : null}
    </article>
  );
}

function Credits({ usage, onAdd }: { usage: AiUsage; onAdd: () => void }): JSX.Element {
  if (usage.credits.length === 0) {
    return (
      <div className="nv-plate cia-none nv-enter">
        <p>
          Aucun crédit noté pour l’instant. Note ta dernière recharge, ou le solde affiché dans la console du
          service : le CRM décompte ensuite chaque appel et te dit quand recharger. Un service payé par ton
          abonnement se note aussi ici, sans montant.
        </p>
        <button type="button" className="nv-btn nv-btn--soft" onClick={onAdd}>
          Noter une recharge
        </button>
      </div>
    );
  }
  return (
    <div className="cia-credits">
      {usage.credits.map((card, i) => (
        <CreditCard key={card.provider} card={card} index={i + 1} />
      ))}
    </div>
  );
}

type Span = 'days' | 'hours';
const SPANS: readonly { readonly id: Span; readonly label: string }[] = [
  { id: 'days', label: '30 jours' },
  { id: 'hours', label: 'Aujourd’hui' },
];

/** The two spans of the chart, a segment whose thumb slides, as the Dashboard's periods. */
function SpanControl({ span, onChange }: { span: Span; onChange: (span: Span) => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const index = SPANS.findIndex((s) => s.id === span);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    placeSegmentThumb(
      element,
      index,
      SPANS.length,
      placed.current ? (thumbRef.current ?? undefined) : undefined,
    );
    placed.current = true;
  }, [index]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = SPANS[(index + step + SPANS.length) % SPANS.length];
    if (next === undefined) return;
    ref.current?.querySelector<HTMLButtonElement>(`[data-span="${next.id}"]`)?.focus();
    onChange(next.id);
  };
  return (
    <div
      className="nv-seg nv-glass nv-glass--thin ins-period"
      role="radiogroup"
      aria-label="Période du graphique"
      ref={ref}
      onKeyDown={onKeyDown}
    >
      <span className="nv-seg__thumb nv-glass nv-glass--thin" ref={thumbRef} aria-hidden="true" />
      {SPANS.map((s) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          className="nv-seg__opt"
          data-span={s.id}
          aria-checked={s.id === span}
          tabIndex={s.id === span ? 0 : -1}
          onClick={() => {
            onChange(s.id);
          }}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/** The spend day by day (hour by hour today), stacked by service; one stop for the keyboard, the arrows walk. */
function Spend({
  columns,
  tip,
  span,
}: {
  columns: readonly Column[];
  tip: FloatingTip;
  span: Span;
}): JSX.Element {
  const [focus, setFocus] = useState(columns.length - 1);
  const current = Math.min(Math.max(0, focus), columns.length - 1);
  const bars = useRef<HTMLDivElement>(null);
  const max = Math.max(0, ...columns.map((column) => column.eur));
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1] ?? 1;
  const every = columns.length <= 8 ? 1 : columns.length <= 14 ? 3 : columns.length <= 24 ? 4 : 5;
  const used = PROVIDERS.filter((_, p) => columns.some((column) => (column.parts[p] ?? 0) > 0));
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === 'Home' ? -columns.length : event.key === 'End' ? columns.length : STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = Math.min(Math.max(0, current + step), columns.length - 1);
    setFocus(next);
    bars.current?.querySelectorAll<HTMLButtonElement>('.ins-col')[next]?.focus();
  };
  if (max <= 0) {
    return (
      <div className="nv-plate ins-daily">
        <p className="ins-empty">
          {span === 'hours'
            ? 'Aucun appel aujourd’hui pour l’instant.'
            : 'Aucun appel ces 30 derniers jours.'}
        </p>
      </div>
    );
  }
  return (
    <div className="nv-plate ins-daily">
      {used.length > 0 ? (
        <ul className="ins-keys" aria-label="Légende">
          {used.map((provider) => (
            <li key={provider.key}>
              <span className="ins-key" style={{ '--_c': provider.colour }} aria-hidden="true" />
              {provider.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ins-daily__plot">
        <div className="ins-daily__grid" aria-hidden="true">
          {ticks.map((value) => (
            <span key={value} style={{ '--_y': `${String((value / top) * 100)}%` }}>
              <i>{axisEur(value)}</i>
            </span>
          ))}
        </div>
        <div
          className="ins-daily__bars"
          style={{ '--_n': columns.length }}
          role="group"
          aria-label={`Dépense ${span === 'hours' ? 'heure par heure' : 'jour par jour'}, au plus ${eurText(max)} : flèches pour passer d’une colonne à l’autre`}
          ref={bars}
          onKeyDown={onKeyDown}
          onFocus={(event) => {
            const at = Number(event.target.getAttribute('data-i'));
            if (Number.isInteger(at)) setFocus(at);
          }}
        >
          {columns.map((column, i) => (
            <button
              type="button"
              key={column.key}
              className="ins-col"
              style={{ '--_i': i }}
              tabIndex={i === current ? 0 : -1}
              aria-label={`${column.title} : ${eurText(column.eur)}, ${countText(column.calls)} appels`}
              data-i={i}
              {...tip.bind(
                {
                  title: column.title,
                  rows: [
                    ...PROVIDERS.map((provider, p) => [provider.label, column.parts[p] ?? 0] as const)
                      .filter(([, eur]) => eur > 0)
                      .map(([label, eur]) => [label, eurText(eur)] as const),
                    ['Total', eurText(column.eur)],
                    ['Appels', countText(column.calls)],
                  ],
                },
                { above: true },
              )}
            >
              <span className="ins-col__stack">
                {column.parts.map((eur, p) =>
                  eur <= 0 ? null : (
                    <span
                      key={PROVIDERS[p]?.key ?? p}
                      className="ins-col__part"
                      style={{
                        '--_c': PROVIDERS[p]?.colour ?? OTHER,
                        '--_h': `${String((eur / top) * 100)}%`,
                      }}
                    />
                  ),
                )}
              </span>
              <span className="ins-col__label" aria-hidden="true">
                {(i % every === 0 && columns.length - 1 - i >= every) || i === columns.length - 1
                  ? column.label
                  : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A ring and its legend: a slice lit on hover, focus or touch shows in the middle and in the legend. */
function Ring({
  title,
  slices,
  tip,
  empty,
}: {
  title: string;
  slices: readonly Slice[];
  tip: FloatingTip;
  empty: string;
}): JSX.Element {
  const [lit, setLit] = useState<number | null>(null);
  const radius = 52;
  const total = slices.reduce((sum, slice) => sum + slice.eur, 0);
  const geometry = arcs(
    slices.map((slice) => slice.eur),
    radius,
  );
  const litSlice = lit === null ? undefined : slices[lit];
  return (
    <article className="nv-plate ins-ring-card">
      <h3 className="ins-card__title">
        {title}
        {total > 0 ? <span className="ins-card__total">{eurText(total)}</span> : null}
      </h3>
      {total <= 0 ? (
        <p className="ins-empty">{empty}</p>
      ) : (
        <div className="ins-ring-row">
          <div
            className={lit === null ? 'ins-ring' : 'ins-ring is-lit'}
            role="img"
            aria-label={`${title} : ${slices.map((s) => `${s.label} ${String(shareOf(s.eur, total))} %`).join(', ')}`}
          >
            <svg viewBox="0 0 132 132" aria-hidden="true">
              <circle className="ins-ring__track" cx="66" cy="66" r={radius} />
              {slices.map((slice, i) => {
                const arc = geometry[i];
                if (arc === undefined) return null;
                return (
                  <circle
                    key={slice.key}
                    className={lit === i ? 'ins-ring__arc is-on' : 'ins-ring__arc'}
                    cx="66"
                    cy="66"
                    r={radius}
                    style={{ '--_c': slice.colour, '--_dash': arc.dash, '--_i': i }}
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
            <span className="ins-ring__middle" aria-hidden="true">
              {litSlice === undefined ? (
                <>
                  <b className="ins-ring__value">{slices.length}</b>
                  <span className="ins-ring__sub">{slices.length > 1 ? 'postes' : 'poste'}</span>
                </>
              ) : (
                <>
                  <b className="ins-ring__value">{String(shareOf(litSlice.eur, total))}&nbsp;%</b>
                  <span className="ins-ring__sub">{litSlice.label}</span>
                </>
              )}
            </span>
          </div>
          <ul className="ins-legend cia-legend">
            {slices.map((slice, i) => {
              const bound = tip.bind({
                title: slice.label,
                rows: [
                  ['Coût', eurText(slice.eur)],
                  ['Part', `${String(shareOf(slice.eur, total))} %`],
                ],
                note: slice.note,
              });
              return (
                <li key={slice.key}>
                  <button
                    type="button"
                    className={lit === i ? 'ins-legend__row is-on' : 'ins-legend__row'}
                    {...bound}
                    onPointerMove={(event) => {
                      if (event.pointerType === 'mouse') setLit(i);
                      bound.onPointerMove(event);
                    }}
                    onPointerLeave={(event) => {
                      if (event.pointerType === 'mouse') setLit(null);
                      bound.onPointerLeave(event);
                    }}
                    onFocus={(event) => {
                      setLit(i);
                      bound.onFocus(event);
                    }}
                    onBlur={() => {
                      setLit(null);
                      bound.onBlur();
                    }}
                  >
                    <span className="ins-key" style={{ '--_c': slice.colour }} aria-hidden="true" />
                    <span className="ins-legend__label">{slice.label}</span>
                    <span className="ins-legend__value">{eurText(slice.eur)}</span>
                    <span className="ins-legend__share">{String(shareOf(slice.eur, total))}&nbsp;%</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </article>
  );
}

/** Réglages › Consommation IA: the owner's alone (the route sends anyone else to Réglages). */
export function AiUsageSection({ now = () => new Date() }: { now?: () => Date } = {}): JSX.Element {
  const query = useAiUsage();
  const tip = useFloatingTip();
  const [span, setSpan] = useState<Span>('days');
  const [adding, setAdding] = useState(false);

  if (query.data === undefined) {
    return (
      <div className="ins-body cia-body">
        {query.isError ? (
          <ServerSilent
            text="La consommation revient dès qu’il répond."
            onRetry={() => void query.refetch()}
          />
        ) : (
          <div
            className="db-loading nv-plate ins-loading"
            aria-label="Chargement de la consommation"
            role="status"
          />
        )}
      </div>
    );
  }
  const usage = query.data;
  const open = (): void => {
    setAdding(true);
  };
  return (
    <div className="ins-body cia-body">
      <Section
        title="La dépense IA"
        sub="relevée à chaque appel, mise à jour toutes les 30 secondes"
        index={1}
      >
        <Today usage={usage} now={now()} />
      </Section>

      <Section
        title="Crédits"
        sub="ce qu’il reste chez chaque service, décompté appel par appel, ou son abonnement"
        index={2}
        control={
          usage.credits.length === 0 ? undefined : (
            <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={open}>
              Noter une recharge
            </button>
          )
        }
      >
        <Credits usage={usage} onAdd={open} />
      </Section>

      <Section
        title="Dépense"
        sub={span === 'days' ? 'jour par jour, par service' : 'heure par heure, par service'}
        index={3}
        control={<SpanControl span={span} onChange={setSpan} />}
      >
        <Spend
          key={span}
          span={span}
          columns={span === 'days' ? dayColumns(usage) : hourColumns(usage)}
          tip={tip}
        />
      </Section>

      <div className="ins-pair nv-enter" style={{ '--nv-i': 4 }}>
        <Ring
          title="Par modèle, 30 jours"
          slices={modelSlices(usage)}
          tip={tip}
          empty="Aucun appel facturé."
        />
        <Ring title="Par usage, 30 jours" slices={useSlices(usage)} tip={tip} empty="Aucun appel facturé." />
      </div>
      <p className="cia-foot">
        Montants en euros au taux prudent du plafond ({usage.usdPerEur.toLocaleString('fr-FR')} $ pour 1 €) :
        les services facturent en dollars. Les vocaux ElevenLabs ne sont pas comptés ici.
      </p>
      {tip.element}
      {adding ? (
        <CreditDialog
          onClose={() => {
            setAdding(false);
          }}
        />
      ) : null}
    </div>
  );
}
