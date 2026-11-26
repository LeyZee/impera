import {
  AVAILABILITY_RANGES_MAX,
  AvailabilityRangesSchema,
  AvailabilityWeekIdSchema,
  newId,
  type MemberAvailability,
} from '@impera/contracts';
import { useState, type JSX } from 'react';

import { TimeField, useUnreadableTimes } from '@/scheduling/TimeField';
import { setMyAvailability, useMyAvailability, useRefreshPlanning, type Refusal } from '@/scheduling/api';
import {
  draftsIssue,
  draftsOf,
  isStale,
  rangesOfDrafts,
  rangeText,
  WEEKDAYS,
  weekSum,
  type DraftRange,
} from '@/scheduling/availability';
import { ERROR_MESSAGES, READ_AGAIN } from '@/scheduling/model';
import { cityOf } from '@/scheduling/time';
import { Dialog } from '@/shell/Dialog';

const DAY_MINUTES = 24 * 60;
const WEEK = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * « Mes dispos » (ADR 0171, trou 16): the week he can work, folded with his leaves and swaps. The agency reads it on
 * each free place; nothing is booked from it.
 */
export function MyAvailability({ now, onEdit }: { now: Date; onEdit: () => void }): JSX.Element | null {
  const week = useMyAvailability();
  if (week.data === undefined) return null;
  const drafts = draftsOf(week.data.ranges);
  const stale = isStale(week.data, now);
  return (
    <details className="nv-disclosure nv-plate sc-fold">
      <summary>
        <span className="nv-disclosure__title">Mes dispos</span>
        <span className="nv-disclosure__sum">{weekSum(week.data.ranges)}</span>
      </summary>
      <div className="nv-disclosure__body">
        <button type="button" className="nv-btn nv-btn--soft nv-btn--sm sc-fold__ask" onClick={onEdit}>
          {drafts.length === 0 ? 'Donner mes dispos' : 'Changer mes dispos'}
        </button>
        {stale ? (
          <p className="tm-hint sc-dispo__stale">
            Tes dispos datent de plus d’un mois : sont-elles toujours justes ?
          </p>
        ) : null}
        {drafts.length === 0 ? (
          <p className="tm-hint">
            Dis une fois quand tu peux travailler : ton manager te verra sur les places libres qui te vont.
          </p>
        ) : (
          <ul className="sc-dispo-week" aria-label="Mes dispos de la semaine">
            {WEEK.map((weekday) => {
              const day = drafts.filter((draft) => draft.weekday === weekday);
              return (
                <li
                  key={weekday}
                  className="sc-dispo-week__day"
                  data-empty={day.length === 0 ? 'true' : undefined}
                >
                  <span className="sc-dispo-week__name">{WEEKDAYS[weekday - 1]}</span>
                  <span className="nv-num sc-dispo-week__ranges">
                    {day.length === 0 ? '—' : day.map((draft) => rangeText(draft)).join(' · ')}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {drafts.length === 0 ? null : (
          <p className="tm-hint">
            À ton heure ({cityOf(week.data.timeZone)}). Une dispo ne crée aucun shift : ton manager choisit.
          </p>
        )}
      </div>
    </details>
  );
}

/** The plage « Ajouter » puts on a day: the evening if the day is empty, else four hours after its last plage. */
function nextOn(day: readonly DraftRange[], key: number, weekday: number): DraftRange {
  const last = day.at(-1);
  if (last === undefined || last.endMinute === 0)
    return { key, weekday, startMinute: 18 * 60, endMinute: 22 * 60 };
  return {
    key,
    weekday,
    startMinute: last.endMinute,
    endMinute: (last.endMinute + 4 * 60) % DAY_MINUTES,
  };
}

/**
 * « Mes dispos », the week set whole (ADR 0171 § 2): a line a day, its plages side by side, each at his own hour. An
 * end at or before its start goes on to the next morning. The week's id is made when the panel opens, so a retry
 * records one week.
 */
export function AvailabilityPanel({
  week,
  onClose,
}: {
  week: MemberAvailability;
  onClose: () => void;
}): JSX.Element {
  const refresh = useRefreshPlanning();
  const [weekId] = useState(() => newId(AvailabilityWeekIdSchema));
  const [drafts, setDrafts] = useState<readonly DraftRange[]>(() => draftsOf(week.ranges));
  const [nextKey, setNextKey] = useState(() => drafts.length);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const { unreadable, onUnreadable } = useUnreadableTimes();

  const ranges = rangesOfDrafts(drafts);
  const issue = unreadable ? 'Une heure à corriger, sur 24 heures : 22, 2230 ou 22:30.' : draftsIssue(drafts);
  const full = (ranges?.length ?? 0) >= AVAILABILITY_RANGES_MAX;
  const ready =
    issue === null && ranges !== null && AvailabilityRangesSchema.safeParse(ranges).success && !busy;

  const change = (key: number, patch: Partial<Pick<DraftRange, 'startMinute' | 'endMinute'>>): void => {
    setDrafts((was) => was.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  };
  const remove = (key: number): void => {
    setDrafts((was) => was.filter((draft) => draft.key !== key));
  };
  const add = (weekday: number): void => {
    setDrafts((was) => [
      ...was,
      nextOn(
        was.filter((draft) => draft.weekday === weekday),
        nextKey,
        weekday,
      ),
    ]);
    setNextKey((key) => key + 1);
  };

  const submit = async (): Promise<void> => {
    if (!ready) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await setMyAvailability({ id: weekId, ranges });
    setBusy(false);
    if (outcome.kind === 'ok') {
      await refresh();
      onClose();
      return;
    }
    if (outcome.kind === 'refused' && READ_AGAIN.has(outcome.code)) await refresh();
    setRefusal(outcome);
  };

  return (
    <Dialog
      title="Mes dispos"
      lead={`Les heures où tu peux travailler, chaque semaine, à ton heure (${cityOf(week.timeZone)}).`}
      busy={busy}
      className="sc-dispo-dialog"
      onClose={onClose}
    >
      <form
        className="tm-dialog__body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ul className="sc-dispo-days" aria-label="Mes plages">
          {WEEK.map((weekday) => {
            const name = WEEKDAYS[weekday - 1] ?? '';
            const day = drafts.filter((draft) => draft.weekday === weekday);
            return (
              <li key={weekday} className="sc-dispo-day" data-empty={day.length === 0 ? 'true' : undefined}>
                <span className="sc-dispo-day__name">{name}</span>
                <div className="sc-dispo-day__ranges">
                  {day.length === 0 ? <span className="tm-hint">Pas dispo</span> : null}
                  {day.map((draft) => (
                    <div
                      key={draft.key}
                      className="sc-dispo-range"
                      role="group"
                      aria-label={`Plage du ${name}`}
                    >
                      <TimeField
                        className="sc-dispo-range__time"
                        value={draft.startMinute}
                        label={`Début de la plage du ${name}`}
                        onChange={(startMinute) => {
                          change(draft.key, { startMinute });
                        }}
                        onUnreadable={onUnreadable}
                      />
                      <span className="tm-hint">à</span>
                      <TimeField
                        className="sc-dispo-range__time"
                        value={draft.endMinute}
                        label={`Fin de la plage du ${name}`}
                        onChange={(endMinute) => {
                          change(draft.key, { endMinute });
                        }}
                        onUnreadable={onUnreadable}
                      />
                      {draft.endMinute !== 0 && draft.endMinute < draft.startMinute ? (
                        <span className="tm-hint sc-dispo-range__next">le lendemain</span>
                      ) : null}
                      <button
                        type="button"
                        className="sc-dispo-range__remove"
                        aria-label={`Retirer la plage du ${name}`}
                        onClick={() => {
                          remove(draft.key);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm sc-dispo-day__add"
                  disabled={full}
                  aria-label={`Ajouter une plage le ${name.toLowerCase()}`}
                  onClick={() => {
                    add(weekday);
                  }}
                >
                  <span aria-hidden="true">+</span> Ajouter
                </button>
              </li>
            );
          })}
        </ul>

        {issue === null ? (
          full ? (
            <p className="tm-hint">{`${String(AVAILABILITY_RANGES_MAX)} plages au plus par semaine.`}</p>
          ) : null
        ) : (
          <p className="tm-hint tm-hint--error" role="status">
            {issue}
          </p>
        )}

        {refusal === null ? null : (
          <p className="tm-warn sc-refusal nv-swap" role="alert">
            {refusal.kind === 'failed'
              ? 'Le serveur ne répond pas : rien n’a été enregistré. Réessaie dans un instant.'
              : ERROR_MESSAGES[refusal.code]}
          </p>
        )}

        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={!ready} aria-busy={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer mes dispos'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
