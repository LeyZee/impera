import { type AgencyCreatorWeek, type CreatorId, type WeekNeed, type WeekPlan } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { creatorWeekKey, useAgencyCreatorWeek, validateCreatorWeek, VALIDATE_ERRORS } from './api';
import {
  addShootDay,
  freeDays,
  loadOf,
  moveDay,
  moveLine,
  overloaded,
  removeShootDay,
  restoreLine,
} from './model';
import './week-plan.css';

import { suggestionsKey } from '@/creators/agenda/api';
import { dayOf, lengthOf, longDay, shortDay } from '@/scheduling/time';
import { Select, type SelectOption } from '@/shell/Select';
import { Failure } from '@/shell/states';

const NEED_LABELS: Readonly<Record<WeekNeed, string>> = {
  script: 'Script',
  feed_shoot: 'Séance feed',
  feed_video: 'Vidéo feed',
  mass_dm: 'Relance',
  idea: 'Idée',
  reveal_story: 'Stories',
};

const DEFERRED = 'deferred';

/**
 * Créatrices › Agenda, her week of shooting (ADR 0140 § 3): the week the code computed on Sunday evening, which the owner
 * reads, corrects (a day moved, a line moved or put off to the week after) and validates; only then does it reach her
 * agenda. An active manager reads it. The agency's minutes show here and never to her.
 */
export function WeekPlanPanel({
  creatorId,
  creatorName,
  timezone,
  week,
  canValidate,
}: {
  creatorId: CreatorId;
  creatorName: string;
  timezone: string;
  week: string;
  canValidate: boolean;
}): JSX.Element {
  const query = useAgencyCreatorWeek(creatorId, week);
  if (query.data === undefined) {
    if (query.isError) return <Failure onRetry={() => void query.refetch()} />;
    return <div className="nv-plate ps-panel ps-skeleton" aria-busy="true" />;
  }
  if (query.data === null)
    return (
      <section className="nv-plate wp-card wp-card--empty" aria-label="Semaine de tournage">
        <p className="wp-title">Semaine de tournage</p>
        <p className="ps-muted">
          Pas encore préparée : elle se calcule le dimanche à partir de 18 h, heure de {creatorName}, puis
          s’affiche ici pour être relue.
        </p>
      </section>
    );
  return (
    <Plan
      key={`${query.data.week}·${query.data.computedAt}·${query.data.state}`}
      creatorId={creatorId}
      creatorName={creatorName}
      timezone={timezone}
      read={query.data}
      canValidate={canValidate}
    />
  );
}

function Plan({
  creatorId,
  creatorName,
  timezone,
  read,
  canValidate,
}: {
  creatorId: CreatorId;
  creatorName: string;
  timezone: string;
  read: AgencyCreatorWeek;
  canValidate: boolean;
}): JSX.Element {
  const client = useQueryClient();
  const [plan, setPlan] = useState<WeekPlan>(read.plan);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const editable = read.state === 'draft' && canValidate;
  const touched = plan !== read.plan;

  const validate = (): void => {
    setBusy(true);
    setFailed(null);
    void validateCreatorWeek(creatorId, read.week, plan).then(async (outcome) => {
      if (outcome.kind === 'ok') client.setQueryData(creatorWeekKey(creatorId, read.week), outcome.week);
      else setFailed(VALIDATE_ERRORS[outcome.kind]);
      await Promise.all([
        client.invalidateQueries({ queryKey: creatorWeekKey(creatorId, read.week) }),
        client.invalidateQueries({ queryKey: suggestionsKey(creatorId, read.week) }),
      ]);
      setBusy(false);
    });
  };

  return (
    <section className="nv-plate wp-card ag-scope" data-cat="shoot" aria-label="Semaine de tournage">
      <header className="wp-head">
        <div className="wp-heading">
          <p className="wp-title">Semaine de tournage</p>
          <p className="ps-muted">
            {read.state === 'validated'
              ? `Validée et envoyée à ${creatorName}. Elle l’accepte dans son agenda.`
              : `Proposée par le calcul de dimanche soir. ${creatorName} ne la voit qu’une fois validée.`}
          </p>
        </div>
        <span className="wp-state" data-state={read.state}>
          {read.state === 'validated' ? 'Validée' : 'À relire'}
        </span>
      </header>
      <p className="wp-facts nv-num">
        Stock : {plan.stock.feed} publications feed, {plan.stock.stories} stories · Livraison avant{' '}
        {longDay(dayOf(plan.dueAt, timezone))}, 23 h
      </p>
      <div className="wp-days">
        {plan.shootDays.map((day) => {
          const others = plan.shootDays.filter((other) => other.day !== day.day);
          const lineTargets: SelectOption<string>[] = [
            ...others.map((other) => ({ value: other.day, label: `Vers ${shortDay(other.day)}` })),
            { value: DEFERRED, label: 'Semaine suivante' },
          ];
          const over = overloaded(day, plan);
          return (
            <article key={day.day} className="wp-day" data-over={over || undefined}>
              <div className="wp-day__head">
                {editable ? (
                  <Select
                    value={day.day}
                    ariaLabel={`Jour de tournage du ${longDay(day.day)}`}
                    options={[day.day, ...freeDays(plan, read.week, day.day).filter((one) => one !== day.day)]
                      .sort()
                      .map((one) => ({ value: one, label: longDay(one) }))}
                    onChange={(to) => {
                      setPlan(moveDay(plan, day.day, to));
                    }}
                  />
                ) : (
                  <b className="wp-day__date">{longDay(day.day)}</b>
                )}
                <span className="wp-load nv-num" data-over={over || undefined}>
                  {lengthOf(loadOf(day) * 60_000)} sur {lengthOf(plan.capacityMinutes * 60_000)}
                </span>
              </div>
              {over ? (
                <p className="wp-warn">Plus que ce qu’une journée tient : reporte ou déplace une ligne.</p>
              ) : null}
              {day.items.length === 0 ? <p className="ps-muted">Rien à tourner ce jour-là.</p> : null}
              <ul className="wp-lines">
                {day.items.map((item, index) => (
                  <li key={`${item.need}·${item.requestId ?? ''}·${String(index)}`} className="wp-line">
                    <span className="wp-need" data-need={item.need}>
                      {NEED_LABELS[item.need]}
                    </span>
                    <span className="wp-line__label">{item.label}</span>
                    <span className="wp-line__min nv-num">{lengthOf(item.minutes * 60_000)}</span>
                    {editable ? (
                      <Select
                        className="wp-move"
                        value=""
                        placeholder="Déplacer"
                        ariaLabel={`Déplacer ${item.label}`}
                        options={lineTargets}
                        listWidth="options"
                        search="never"
                        onChange={(to) => {
                          setPlan(moveLine(plan, day.day, index, to === DEFERRED ? 'deferred' : { day: to }));
                        }}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
              {editable && plan.shootDays.length > 1 ? (
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm wp-remove"
                  onClick={() => {
                    setPlan(removeShootDay(plan, day.day));
                  }}
                >
                  Retirer ce jour
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
      {plan.deferred.length === 0 ? null : (
        <div className="wp-deferred">
          <p className="wp-deferred__title">Reporté à la semaine suivante</p>
          <ul className="wp-lines">
            {plan.deferred.map((item, index) => (
              <li key={`${item.need}·${item.requestId ?? ''}·${String(index)}`} className="wp-line">
                <span className="wp-need" data-need={item.need}>
                  {NEED_LABELS[item.need]}
                </span>
                <span className="wp-line__label">{item.label}</span>
                <span className="wp-line__min nv-num">{lengthOf(item.minutes * 60_000)}</span>
                {editable ? (
                  <button
                    type="button"
                    className="nv-btn nv-btn--plain nv-btn--sm"
                    onClick={() => {
                      setPlan(restoreLine(plan, index));
                    }}
                  >
                    Remettre
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {failed === null ? null : (
        <p className="wp-failed" role="alert">
          {failed}
        </p>
      )}
      {editable ? (
        <div className="wp-actions">
          <button
            type="button"
            className="nv-btn nv-btn--neon nv-btn--sm"
            disabled={busy}
            aria-busy={busy}
            onClick={validate}
          >
            Valider et envoyer
          </button>
          {plan.shootDays.length < 3 ? (
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              disabled={busy}
              onClick={() => {
                setPlan(addShootDay(plan, read.week));
              }}
            >
              Ajouter un jour
            </button>
          ) : null}
          {touched ? (
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              disabled={busy}
              onClick={() => {
                setPlan(read.plan);
              }}
            >
              Revenir au calcul
            </button>
          ) : null}
        </div>
      ) : read.state === 'draft' ? (
        <p className="ps-muted">Seul le propriétaire valide la semaine.</p>
      ) : canValidate ? (
        // Validated: the same gesture again writes in her agenda what a cut network may have left out; never twice.
        <div className="wp-actions">
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            disabled={busy}
            aria-busy={busy}
            onClick={validate}
          >
            Renvoyer dans son agenda
          </button>
        </div>
      ) : null}
    </section>
  );
}
