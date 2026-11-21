import {
  AI_FORECAST_TRAFFIC_GROWTH,
  type AiForecast,
  type AiForecastRange,
  type AiSpendLine,
} from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { countText, eurText } from './view';

import { CountUp } from '@/screens/dashboard/parts';

/*
 * The forecast (ADR 0091 § 8): what the AI will cost this month and next, for the owner's cash flow. Every figure is
 * the server's; this block only lays them out.
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

/** « décembre », from YYYY-MM. */
export function monthName(month: string): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
}

/** A whole euro past 100 €: a forecast is never read to the cent. */
export function forecastEur(eur: number): string {
  if (eur < 100) return eurText(eur);
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

function Rows({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: readonly {
    readonly key: string;
    readonly name: string;
    readonly line: string;
    readonly range: AiForecastRange;
  }[];
  empty: string;
}): JSX.Element {
  const end = Math.max(0, ...rows.map((r) => r.range.high));
  return (
    <div className="nv-plate cia-fc-list">
      <h3 className="nv-h3">{title}</h3>
      {rows.length === 0 ? (
        <p className="ins-none">{empty}</p>
      ) : (
        <ol className="cia-fc-rows">
          {rows.map((row, i) => (
            <li key={row.key} className="cia-fc-row nv-enter" style={{ '--nv-i': i }}>
              <span className="cia-fc-row__who">
                <span className="cia-fc-row__name">{row.name}</span>
                <span className="cia-fc-row__line">{row.line}</span>
              </span>
              <span className="cia-fc-row__value">
                {forecastEur(row.range.realistic)}
                <span className="cia-fc-row__range">{rangeText(row.range)}</span>
              </span>
              <Band range={row.range} end={end} label={row.name} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function Forecast({ forecast }: { forecast: AiForecast | null }): JSX.Element {
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
  const end = Math.max(nextMonth.high, forecast.moreTraffic.nextMonthEur) * 1.08;
  const growth = `${String(Math.round(AI_FORECAST_TRAFFIC_GROWTH * 100))}\u00a0%`;
  // Two sentences at most (Design, 21/11): what happens, then where to raise the cap, by its button.
  const capWarning = cap.reachedAtRealistic
    ? `Au rythme actuel, l’IA dépasse le plafond de ${eurText(cap.capEur)} par jour : il l’arrête chaque jour, les chatteurs prennent la suite, et ${next} ne dépassera pas ${forecastEur(cap.nextMonthMaxEur)}. Pour tout laisser à l’IA, il faudrait un plafond d’environ ${forecastEur(Math.ceil(nextMonth.realistic / daysOf(nextMonth.month)))} par jour.`
    : cap.reachedWithMoreTraffic
      ? `Avec ${growth} de trafic en plus, le plafond de ${eurText(cap.capEur)} par jour arrêterait l’IA en cours de journée. Il se relève dans les réglages des modèles.`
      : null;

  return (
    <div className="cia-fc">
      <div className="ins-figures">
        <div className="ins-figures-stack">
          <div className="nv-plate ins-lead cia-fc-lead nv-enter" style={{ '--nv-i': 1 }}>
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
            <div className="cia-fc-lead__band">
              <Band range={nextMonth} end={end} label={`Prévu en ${next}`} />
              <div className="cia-gauge__scale" aria-hidden="true">
                <span>bas {forecastEur(nextMonth.low)}</span>
                <span>haut {forecastEur(nextMonth.high)}</span>
              </div>
              <p className="cia-gauge__note">
                {`En ${current} : ${forecastEur(thisMonth.realistic)} prévus, dont ${forecastEur(thisMonth.monthSoFarEur)} déjà dépensés.`}
              </p>
            </div>
          </div>
          {capWarning === null ? null : (
            <div className="nv-plate cia-fc-cap nv-enter" role="note" style={{ '--nv-i': 2 }}>
              <span className="cia-fc-cap__icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" width="18" height="18">
                  <path
                    d="M10 2.5 18 16.5H2z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M10 8v4M10 14.2v.3"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <p className="cia-fc-cap__text">{capWarning}</p>
              <Link to="/reglages/modeles-ia" className="nv-btn nv-btn--soft nv-btn--sm cia-fc-cap__act">
                Régler le plafond
              </Link>
            </div>
          )}
        </div>
        <dl className="ins-tiles cia-tiles">
          {(
            [
              {
                label: `Avec ${growth} de trafic en plus`,
                value: forecastEur(forecast.moreTraffic.nextMonthEur),
                note: `en ${next} : les conversations augmentent, le reste ne bouge pas`,
              },
              {
                label: 'Une conversation, une journée',
                value:
                  forecast.eurPerConversationDay === null ? '—' : eurText(forecast.eurPerConversationDay),
                note: `${countText(Math.round(forecast.conversationsPerDay))} conversation${forecast.conversationsPerDay >= 2 ? 's' : ''} par jour, la dernière semaine`,
              },
              {
                label: 'Part des ventes',
                value: sales === null ? '—' : shareText(sales.aiShare),
                note:
                  sales === null
                    ? 'aucune vente lue sur ces jours'
                    : `de ${forecastEur(sales.nextMonthEur)} de ventes prévues en ${next}, net de Reveal`,
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

      <div className="ins-pair cia-fc-pair nv-enter" style={{ '--nv-i': 6 }}>
        <Rows
          title={`Par usage, en ${next}`}
          empty="Aucun appel facturé."
          rows={forecast.lines.map((line) => ({
            key: line.line,
            name: LINE_LABELS[line.line],
            line: LINE_NOTES[line.line],
            range: line.nextMonth,
          }))}
        />
        <Rows
          title={`Par créatrice, en ${next}`}
          empty="Aucune créatrice n’a encore d’appel."
          rows={forecast.creators.map((creator) => ({
            key: creator.creatorId,
            name: creator.name,
            line:
              creator.salesNextMonthEur === null || creator.salesNextMonthEur === 0
                ? `${countText(Math.round(creator.conversationsPerDay))} conversations par jour`
                : `${shareText(creator.nextMonth.realistic / creator.salesNextMonthEur)} de ses ventes prévues`,
            range: creator.nextMonth,
          }))}
        />
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
