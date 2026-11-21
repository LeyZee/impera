import {
  AI_FORECAST_TRAFFIC_GROWTH,
  type AiForecast,
  type AiForecastRange,
  type AiSpendLine,
  type AiUsageDay,
} from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { ForecastChart, daysBetween, type CurveDay } from './ForecastChart';
import { countText, eurText } from './view';

import { CountUp, type FloatingTip } from '@/screens/dashboard/parts';

/*
 * The forecast (ADR 0091 § 8): what the AI will cost this month and next, for the owner's cash flow. Every figure is
 * the server's; this block lays them out, the verdict first, so the screen reads at a glance (Charles, 21/11).
 */

export const LINE_LABELS: Readonly<Record<AiSpendLine, string>> = {
  chatting: 'Chatting Reveal',
  media: 'Médias et scripts décrits',
  telegram: 'Canal Telegram',
  instagram: 'Instagram',
  playground: 'Playground et tests',
  other: 'Essais des services',
};

const LINE_NOTES: Readonly<Record<AiSpendLine, string>> = {
  chatting: 'grandit avec le nombre de conversations',
  media: 'ce qu’elle dépose, décrit par l’IA',
  telegram: 'les posts de son canal',
  instagram: 'réponses aux commentaires et veille',
  playground: 'vos essais et les tests de qualité',
  other: 'les « Essai réel » des Réglages',
};

/** One colour a line of spend, the same in the bar, its key and its row. */
const LINE_COLOURS: Readonly<Record<AiSpendLine, string>> = {
  chatting: 'var(--nv-series-1)',
  media: 'var(--nv-series-2)',
  telegram: 'var(--nv-series-3)',
  instagram: 'var(--nv-series-4)',
  playground: 'var(--nv-data-2)',
  other: 'var(--nv-series-other)',
};

/** Past this share of the sales, the verdict turns amber: more than one euro in five goes to the AI. */
const HEAVY_SHARE = 0.2;
/** A day spent this close to the cap is read as stopped by it (the last call may land a little under). */
const CAPPED_AT = 0.97;
/** The days of spend the curve shows before today. */
const CURVE_PAST = 14;

/** « décembre », from YYYY-MM. */
export function monthName(month: string): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
}

/** One rounding for every forecast figure: the whole euro from 10 €, the cent under it (« 86 € », « 0,38 € »). */
export function forecastEur(eur: number): string {
  if (eur < 10) return eurText(eur);
  return `${Math.round(eur).toLocaleString('fr-FR')}\u00a0€`;
}

export function shareText(share: number): string {
  return `${(share * 100).toLocaleString('fr-FR', { maximumFractionDigits: share < 0.1 ? 1 : 0 })}\u00a0%`;
}

function daysOf(month: string): number {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, m ?? 1, 0)).getUTCDate();
}

function rangeText(range: AiForecastRange): string {
  return `de ${forecastEur(range.low)} à ${forecastEur(range.high)}`;
}

type Tone = 'ok' | 'warn';

/** The verdict under the big figure: one sentence, amber when the cap or the sales say to look. */
export function verdictOf(
  forecast: AiForecast,
  capped: { readonly days: number; readonly of: number } = { days: 0, of: 0 },
): { tone: Tone; text: string; cap: boolean } {
  const { nextMonth, cap, sales } = forecast;
  const next = monthName(nextMonth.month);
  const amount = forecastEur(nextMonth.realistic);
  const growth = `${String(Math.round(AI_FORECAST_TRAFFIC_GROWTH * 100))}\u00a0%`;
  if (cap.reachedAtRealistic) {
    return {
      tone: 'warn',
      cap: true,
      text: `Au rythme actuel, l’IA bute chaque jour sur le plafond de ${forecastEur(cap.capEur)} : ${next} s’arrête à ${forecastEur(cap.nextMonthMaxEur)} et les chatteurs prennent la suite. Pour tout lui laisser, il faudrait un plafond d’environ ${forecastEur(Math.ceil(nextMonth.realistic / daysOf(nextMonth.month)))} par jour.`,
    };
  }
  // The cap stops the calls, so the journal never sees a day past it: days that hit it hide part of the need.
  if (capped.days > 0) {
    return {
      tone: 'warn',
      cap: true,
      text: `L’IA a buté sur le plafond de ${forecastEur(cap.capEur)} ${String(capped.days)} jour${capped.days > 1 ? 's' : ''} sur les ${String(capped.of)} derniers : les chatteurs ont pris la suite, et le vrai besoin est plus haut que ces ${amount} prévus en ${next}.`,
    };
  }
  if (sales !== null && sales.aiShare >= HEAVY_SHARE) {
    return {
      tone: 'warn',
      cap: false,
      text: `${amount} en ${next}, soit ${shareText(sales.aiShare)} de vos ventes : plus d’un euro sur cinq part dans l’IA, à surveiller.`,
    };
  }
  if (cap.reachedWithMoreTraffic) {
    return {
      tone: 'warn',
      cap: true,
      text: `Tout va bien au rythme actuel, mais avec ${growth} de trafic en plus, le plafond de ${forecastEur(cap.capEur)} par jour arrêterait l’IA en cours de journée.`,
    };
  }
  return {
    tone: 'ok',
    cap: false,
    text:
      sales === null
        ? `Tout va bien : ${amount} prévus en ${next}, bien sous le plafond de ${forecastEur(cap.capEur)} par jour.`
        : `Tout va bien : ${amount} prévus en ${next}, ${shareText(sales.aiShare)} de vos ventes, bien sous le plafond.`,
  };
}

const formatShare = (value: number): string => shareText(value);

/** Low to high as a band on a track, the realistic figure as a mark; the scale ends past the busiest case. */
function Band({ range, end, label }: { range: AiForecastRange; end: number; label: string }): JSX.Element {
  const at = (eur: number): string => `${String(end === 0 ? 0 : Math.min(100, (eur / end) * 100))}%`;
  return (
    <div
      className="cia-band"
      role="img"
      aria-label={`${label} : ${forecastEur(range.realistic)}, ${rangeText(range)}`}
    >
      <span className="cia-band__span" style={{ '--_from': at(range.low), '--_to': at(range.high) }} />
      <span className="cia-band__mark" style={{ '--_x': at(range.realistic) }} />
    </div>
  );
}

/** By line of spend: one bar split by colour, then a row a line; a row under the pointer lights its part. */
function Lines({
  forecast,
  next,
  tip,
}: {
  forecast: AiForecast;
  next: string;
  tip: FloatingTip;
}): JSX.Element {
  const [lit, setLit] = useState<AiSpendLine | null>(null);
  const total = forecast.lines.reduce((sum, l) => sum + l.nextMonth.realistic, 0);
  return (
    <div className="nv-plate cia-fc-list">
      <h3 className="nv-h3">{`Par usage, en ${next}`}</h3>
      {forecast.lines.length === 0 || total <= 0 ? (
        <p className="ins-none">Aucun appel facturé.</p>
      ) : (
        <>
          <div
            className={`ins-money__bar cia-fc-bar${lit === null ? '' : ' is-lit'}`}
            role="img"
            aria-label={`Par usage : ${forecast.lines
              .map((l) => `${LINE_LABELS[l.line]} ${forecastEur(l.nextMonth.realistic)}`)
              .join(' ; ')}`}
          >
            {forecast.lines.map((l) =>
              l.nextMonth.realistic <= 0 ? null : (
                <span
                  key={l.line}
                  className={`ins-money__part${lit === l.line ? ' is-on' : ''}`}
                  style={{ flexGrow: l.nextMonth.realistic, background: LINE_COLOURS[l.line] }}
                  {...tip.bind(
                    {
                      title: LINE_LABELS[l.line],
                      rows: [
                        [`En ${next}`, forecastEur(l.nextMonth.realistic)],
                        ['Part', shareText(l.nextMonth.realistic / total)],
                        ['Par jour', forecastEur(l.perDay.realistic)],
                      ],
                    },
                    { above: true },
                  )}
                />
              ),
            )}
          </div>
          <ol className="cia-fc-rows">
            {forecast.lines.map((l, i) => (
              <li
                key={l.line}
                className="cia-fc-row cia-fc-row--keyed nv-enter"
                style={{ '--nv-i': i, '--_c': LINE_COLOURS[l.line] }}
                onPointerEnter={() => {
                  setLit(l.line);
                }}
                onPointerLeave={() => {
                  setLit(null);
                }}
              >
                <span className="cia-fc-row__key" aria-hidden="true" />
                <span className="cia-fc-row__who">
                  <span className="cia-fc-row__name">{LINE_LABELS[l.line]}</span>
                  <span className="cia-fc-row__line">{LINE_NOTES[l.line]}</span>
                </span>
                <span className="cia-fc-row__value">
                  <CountUp value={l.nextMonth.realistic} format={forecastEur} />
                  <span className="cia-fc-row__range">{shareText(l.nextMonth.realistic / total)}</span>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function Creators({ forecast, next }: { forecast: AiForecast; next: string }): JSX.Element {
  const end = Math.max(0, ...forecast.creators.map((c) => c.nextMonth.high));
  return (
    <div className="nv-plate cia-fc-list">
      <h3 className="nv-h3">{`Par créatrice, en ${next}`}</h3>
      {forecast.creators.length === 0 ? (
        <p className="ins-none">Aucune créatrice n’a encore d’appel.</p>
      ) : (
        <ol className="cia-fc-rows">
          {forecast.creators.map((creator, i) => (
            <li key={creator.creatorId} className="cia-fc-row nv-enter" style={{ '--nv-i': i }}>
              <span className="cia-fc-row__who">
                <span className="cia-fc-row__name">{creator.name}</span>
                <span className="cia-fc-row__line">
                  {creator.salesNextMonthEur === null || creator.salesNextMonthEur === 0
                    ? `${countText(Math.round(creator.conversationsPerDay))} conversations par jour`
                    : `${shareText(creator.nextMonth.realistic / creator.salesNextMonthEur)} de ses ventes prévues`}
                </span>
              </span>
              <span className="cia-fc-row__value">
                <CountUp value={creator.nextMonth.realistic} format={forecastEur} />
                <span className="cia-fc-row__range">{rangeText(creator.nextMonth)}</span>
              </span>
              <Band range={creator.nextMonth} end={end} label={creator.name} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The curve's days: up to fourteen full days spent, then today to the end of next month. */
function curveOf(
  days: readonly AiUsageDay[],
  today: string,
  nextMonth: string,
): { past: CurveDay[]; future: string[] } {
  const spent = new Map(days.map((d) => [d.day, d.eur]));
  const first = days.reduce<string | null>(
    (min, d) => (d.eur > 0 && (min === null || d.day < min) ? d.day : min),
    null,
  );
  const before = (n: number): string =>
    new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  const window = daysBetween(before(CURVE_PAST), before(1)).filter((day) => first !== null && day >= first);
  return {
    past: window.map((day) => ({ day, spent: spent.get(day) ?? 0 })),
    future: daysBetween(today, `${nextMonth}-${String(daysOf(nextMonth)).padStart(2, '0')}`),
  };
}

export function Forecast({
  forecast,
  days,
  today,
  tip,
}: {
  forecast: AiForecast | null;
  days: readonly AiUsageDay[];
  today: string;
  tip: FloatingTip;
}): JSX.Element {
  if (forecast === null) {
    return (
      <p className="nv-plate ins-empty">
        Le prévisionnel apparaît après une première journée complète avec des appels.
      </p>
    );
  }
  const { thisMonth, nextMonth, cap, sales } = forecast;
  const next = monthName(nextMonth.month);
  const current = monthName(thisMonth.month);
  const growth = `${String(Math.round(AI_FORECAST_TRAFFIC_GROWTH * 100))}\u00a0%`;
  const curve = curveOf(days, today, nextMonth.month);
  const verdict = verdictOf(forecast, {
    days: curve.past.filter((d) => (d.spent ?? 0) >= cap.capEur * CAPPED_AT).length,
    of: curve.past.length,
  });
  const nextDays = daysOf(nextMonth.month);
  const perDay: AiForecastRange = {
    low: nextMonth.low / nextDays,
    realistic: nextMonth.realistic / nextDays,
    high: nextMonth.high / nextDays,
  };

  return (
    <div className="cia-fc">
      <div className="nv-plate cia-fc-hero nv-enter" style={{ '--nv-i': 1 }}>
        <div className="cia-fc-hero__figures">
          <div className="nv-figure">
            <span className="nv-figure__label">
              {cap.reachedAtRealistic ? `Prévu en ${next}, sans plafond` : `Prévu en ${next}`}
            </span>
            <CountUp
              className="nv-figure__value ins-lead__value"
              value={nextMonth.realistic}
              format={forecastEur}
            />
            <span className="nv-figure__note">{`${rangeText(nextMonth)} selon les semaines`}</span>
          </div>
          <div className="nv-figure">
            <span className="nv-figure__label">Part de vos ventes</span>
            {sales === null ? (
              <span className="nv-figure__value ins-lead__value">—</span>
            ) : (
              <CountUp
                className="nv-figure__value ins-lead__value"
                value={sales.aiShare}
                format={formatShare}
              />
            )}
            <span className="nv-figure__note">
              {sales === null
                ? 'aucune vente lue sur ces jours'
                : `de ${forecastEur(sales.nextMonthEur)} de ventes prévues en ${next}, net de Reveal`}
            </span>
          </div>
        </div>
        <div
          className="cia-fc-verdict"
          data-tone={verdict.tone}
          role={verdict.tone === 'warn' ? 'note' : undefined}
        >
          <span className="cia-fc-verdict__icon" aria-hidden="true">
            {verdict.tone === 'ok' ? (
              <svg viewBox="0 0 20 20" width="18" height="18">
                <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path
                  d="m6.5 10.2 2.4 2.4 4.6-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" width="18" height="18">
                <path
                  d="M10 2.5 18 16.5H2z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path d="M10 8v4M10 14.2v.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
          </span>
          <p className="cia-fc-verdict__text">{verdict.text}</p>
          {verdict.cap ? (
            <Link to="/reglages/modeles-ia" className="nv-btn nv-btn--soft nv-btn--sm cia-fc-verdict__act">
              Régler le plafond
            </Link>
          ) : null}
        </div>
        <ForecastChart
          past={curve.past}
          future={curve.future}
          perDay={perDay}
          capEur={cap.capEur}
          format={forecastEur}
        />
        <ul className="cia-curve__keys" aria-hidden="true">
          <li data-k="spent">Dépensé</li>
          <li data-k="pace">Prévu, au rythme de la dernière semaine</li>
          <li data-k="band">Semaine calme à chargée</li>
          <li data-k="cap">Plafond du jour</li>
        </ul>
      </div>

      <dl className="ins-tiles cia-fc-tiles">
        {(
          [
            {
              label: `Déjà dépensé en ${current}`,
              value: thisMonth.monthSoFarEur,
              format: forecastEur,
              note: `${forecastEur(thisMonth.realistic)} prévus d’ici la fin du mois`,
            },
            {
              label: `Avec ${growth} de trafic en plus`,
              value: forecast.moreTraffic.nextMonthEur,
              format: forecastEur,
              note: `en ${next} : les conversations augmentent, le reste ne bouge pas`,
            },
            {
              label: 'Une conversation, une journée',
              value: forecast.eurPerConversationDay,
              format: eurText,
              note: `${countText(Math.round(forecast.conversationsPerDay))} conversation${forecast.conversationsPerDay >= 2 ? 's' : ''} par jour, la dernière semaine`,
            },
          ] as const
        ).map((t, i) => (
          <div key={t.label} className="nv-plate ins-tile nv-enter" style={{ '--nv-i': i + 2 }}>
            <dt>{t.label}</dt>
            <dd>
              {t.value === null ? (
                <span className="ins-tile__value">—</span>
              ) : (
                <CountUp className="ins-tile__value" value={t.value} format={t.format} />
              )}
            </dd>
            <dd className="ins-tile__note">{t.note}</dd>
          </div>
        ))}
      </dl>

      <div className="ins-pair cia-fc-pair nv-enter" style={{ '--nv-i': 6 }}>
        <Lines forecast={forecast} next={next} tip={tip} />
        <Creators forecast={forecast} next={next} />
      </div>
      <p className="cia-foot">
        {forecast.basisDays < 8
          ? `Lu sur ${String(forecast.basisDays)} jour${forecast.basisDays > 1 ? 's' : ''} complet${forecast.basisDays > 1 ? 's' : ''} seulement : le bas et le haut sont 20 % sous le rythme et 25 % au-dessus, en attendant deux semaines de recul.`
          : 'Au rythme de la dernière semaine ; le bas et le haut sont la plus calme et la plus chargée des deux dernières semaines.'}{' '}
        Les ventes sont le net de Reveal, remboursements déduits, lues sur les mêmes jours.
      </p>
    </div>
  );
}
