import type {
  SalesFeedCheckDay,
  SalesFeedCheckReport,
  SalesFeedCheckTotals,
  SalesFeedChatterLink,
  SalesFeedModelLink,
} from '@nirvana/contracts';
import type { JSX } from 'react';

import {
  chatterLine,
  dayModelLabel,
  daysInGap,
  FIGURES,
  figureGap,
  gap,
  money,
  noteText,
  rangeLabel,
  verdictOf,
} from './check';
import { ago } from './view';

import { useMembers } from '@/screens/team/api';

const WEEKDAY = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
/** « lun. 3 nov. », « sam. 1er nov. ». */
const shortDay = (day: string): string =>
  WEEKDAY.format(new Date(`${day}T00:00:00Z`)).replace(/ 1 /u, ' 1er ');

const zoneName = (timeZone: string): string => (timeZone === 'Europe/Paris' ? 'heure de Paris' : timeZone);

type Source = 'stats' | 'export';

/**
 * A figure of a source, with its gap to the register (`register` given) when it has one; « — » for a figure the
 * source does not give. The register's own column passes no `register`.
 */
function Cell({
  totals,
  register,
  figure,
}: {
  totals: SalesFeedCheckTotals | null;
  register?: SalesFeedCheckTotals;
  figure: (typeof FIGURES)[number]['key'];
}): JSX.Element {
  const value = totals?.[figure] ?? null;
  if (totals === null || value === null) return <td className="sf-num sf-faint">—</td>;
  const off = register === undefined ? null : figureGap(register, totals, figure);
  const isOff = off !== null && off !== 0;
  return (
    <td className="sf-num" data-off={isOff ? 'true' : undefined}>
      {money(value)}
      {isOff ? <small className="sf-gap">{gap(off)}</small> : null}
    </td>
  );
}

/**
 * The report of a reliability check (CRM-02): the verdict, the notes, the totals of the three sources, the days in
 * gap first, then every day, then each team member. Amounts in euros; a figure a source does not give is « — ».
 */
export function CheckReport({
  report,
  platformName,
  models,
  chatters,
  now,
}: {
  report: SalesFeedCheckReport;
  platformName: string;
  models: readonly SalesFeedModelLink[];
  chatters: readonly SalesFeedChatterLink[];
  now: Date;
}): JSX.Element {
  const verdict = verdictOf(report.verdict);
  const hasMembers = chatters.some((chatter) => chatter.link?.kind === 'member');
  const members = useMembers(hasMembers);
  const memberName = (memberId: string): string | null =>
    members.data?.find((member) => member.id === memberId)?.displayName ?? null;
  const inGap = daysInGap(report.days);
  const sources: readonly { key: 'register' | Source; label: string }[] = [
    { key: 'register', label: 'Registre' },
    { key: 'stats', label: 'Statistiques' },
    { key: 'export', label: 'Export' },
  ];

  return (
    <div className="sf-report" aria-label="Résultat de la vérification">
      <div className="sf-verdict" data-verdict={report.verdict}>
        <span className="sv-dot sv-dot--big" data-dot={verdict.dot} />
        <div className="sf-verdict__text">
          <h4 className="sf-verdict__title">{verdict.title}</h4>
          <p className="sv-muted">{verdict.line}</p>
          <p className="sf-meta">
            {rangeLabel(report).replace(/^./u, (first) => first.toUpperCase())}, jours de {platformName} (
            {zoneName(report.timeZone)}) · registre lu{' '}
            {report.registerReadAt === null ? 'jamais' : ago(report.registerReadAt, now)}
          </p>
        </div>
      </div>

      {report.notes.length > 0 ? (
        <ul className="sf-notes">
          {report.notes.map((note) => (
            <li key={JSON.stringify(note)} className="sf-warn">
              {noteText(note, platformName, chatters, memberName)}
            </li>
          ))}
        </ul>
      ) : null}

      <section className="sf-block" aria-labelledby="sf-check-total">
        <h5 id="sf-check-total" className="sf-block__title">
          Sur la période
        </h5>
        <div className="sf-scroll">
          <table className="sf-table">
            <thead>
              <tr>
                <th scope="col">Montant</th>
                {sources.map((source) => (
                  <th key={source.key} scope="col" className="sf-num">
                    {source.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FIGURES.map((figure) => (
                <tr key={figure.key}>
                  <th scope="row">{figure.label}</th>
                  <Cell totals={report.total.register} figure={figure.key} />
                  <Cell totals={report.total.stats} register={report.total.register} figure={figure.key} />
                  <Cell totals={report.total.export} register={report.total.register} figure={figure.key} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report.total.export === null ? (
          <p className="sv-muted sf-small">Sans export, le registre n’est comparé qu’aux statistiques.</p>
        ) : null}
      </section>

      <section className="sf-block" aria-labelledby="sf-check-gaps">
        <h5 id="sf-check-gaps" className="sf-block__title">
          {inGap.length === 0
            ? 'Aucun jour en écart'
            : `${String(inGap.length)} ${inGap.length > 1 ? 'jours en écart' : 'jour en écart'}`}
        </h5>
        {inGap.length === 0 ? (
          <p className="sv-muted sf-small">
            {report.days.length === 0
              ? 'Aucune vente sur ces jours, dans aucune source.'
              : `Sur ${String(report.days.length)} jours de ventes par modèle, chaque source dit le chiffre du registre.`}
          </p>
        ) : (
          <ul className="sf-gaps">
            {inGap.map((day) => (
              <GapDay key={`${day.date}|${day.platformModelId}`} day={day} models={models} />
            ))}
          </ul>
        )}
        {report.days.length > 0 ? (
          <details className="nv-disclosure sf-all">
            <summary>Tous les jours ({report.days.length})</summary>
            <div className="sf-scroll">
              <table className="sf-table">
                <thead>
                  <tr>
                    <th scope="col">Jour</th>
                    <th scope="col">Modèle</th>
                    <th scope="col" className="sf-num">
                      Registre
                    </th>
                    <th scope="col" className="sf-num">
                      Statistiques
                    </th>
                    <th scope="col" className="sf-num">
                      Export
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((day) => (
                    <tr key={`${day.date}|${day.platformModelId}`}>
                      <td className="sf-nowrap">{shortDay(day.date)}</td>
                      <td>{dayModelLabel(day, models)}</td>
                      <Cell totals={day.register} figure="net" />
                      <Cell totals={day.stats} register={day.register} figure="net" />
                      <Cell totals={day.export} register={day.register} figure="net" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </section>

      {report.chatters.length > 0 ? (
        <section className="sf-block" aria-labelledby="sf-check-team">
          <h5 id="sf-check-team" className="sf-block__title">
            Par membre de l’équipe {platformName}
          </h5>
          <div className="sf-scroll">
            <table className="sf-table">
              <thead>
                <tr>
                  <th scope="col">Membre</th>
                  <th scope="col" className="sf-num">
                    Registre
                  </th>
                  <th scope="col" className="sf-num">
                    Statistiques
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.chatters.map((row) => {
                  const line = chatterLine(row, chatters, memberName);
                  const off = row.stats === null ? null : row.stats.net - row.register.net;
                  return (
                    <tr key={row.platformChatterId ?? 'nobody'}>
                      <th scope="row" className="sf-who">
                        <span>
                          {line.name}
                          {row.isBot === true ? <span className="nv-tag nv-tag--declared">Bot</span> : null}
                        </span>
                        <small>{line.link}</small>
                      </th>
                      <td className="sf-num">
                        {money(row.register.net)}
                        <small className="sf-faint">{salesCount(row.register.sales)}</small>
                      </td>
                      {row.stats === null ? (
                        <td className="sf-num sf-faint">—</td>
                      ) : (
                        <td className="sf-num" data-off={row.differs ? 'true' : undefined}>
                          {money(row.stats.net)}
                          {off !== null && off !== 0 ? <small className="sf-gap">{gap(off)}</small> : null}
                          <small className="sf-faint">{salesCount(row.stats.sales)}</small>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="sv-muted sf-small">
            Seul le net compte pour l’écart. Le nombre de ventes est affiché pour information : {platformName}{' '}
            ne dit pas si le sien retire les remboursements.
          </p>
        </section>
      ) : null}
    </div>
  );
}

const salesCount = (count: number): string => `${String(count)} ${Math.abs(count) > 1 ? 'ventes' : 'vente'}`;

const SOURCE_NAMES: Record<Source, string> = { stats: 'Statistiques', export: 'Export' };

/** A day in gap: for each source that differs, the figures it gives otherwise than the register. */
function GapDay({
  day,
  models,
}: {
  day: SalesFeedCheckDay;
  models: readonly SalesFeedModelLink[];
}): JSX.Element {
  return (
    <li className="sf-gapday">
      <p className="sf-gapday__head">
        <span className="sf-nowrap">{shortDay(day.date)}</span>
        <span>{dayModelLabel(day, models)}</span>
        {day.linked ? null : <span className="nv-tag nv-tag--inferred">Non reliée</span>}
      </p>
      <p className="sv-muted sf-small">
        Registre : {day.register.net === null ? '—' : money(day.register.net)} net
      </p>
      {day.differs.map((source) => {
        const totals = day[source];
        if (totals === null) return null;
        const parts = FIGURES.flatMap((figure) => {
          const off = figureGap(day.register, totals, figure.key);
          const value = totals[figure.key];
          return off === null || off === 0 || value === null
            ? []
            : [`${figure.label.toLowerCase()} ${money(value)} (${gap(off)})`];
        });
        return (
          <p key={source} className="sf-warn sf-small">
            {SOURCE_NAMES[source]} : {parts.join(', ')}
          </p>
        );
      })}
    </li>
  );
}
