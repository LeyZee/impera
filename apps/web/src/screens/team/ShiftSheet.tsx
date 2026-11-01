import type {
  Planning,
  Shift,
  ShiftReport,
  ShiftTemplate,
  TeamMember,
  UpdateShiftBody,
} from '@nirvana/contracts';
import { Link } from '@tanstack/react-router';
import { useId, useState, type JSX } from 'react';

import { Dialog } from './Dialog';

import { AGENCY_STATUS, amountText, periodAt, reportOf, STATUS_TONES, validatedTotal } from '@/reports/model';
import '@/reports/reports.css';
import { TimeField, useUnreadableTimes } from '@/scheduling/TimeField';
import {
  cancelShift,
  endTemplate,
  updateShift,
  useRefreshPlanning,
  type Outcome,
  type Refusal,
} from '@/scheduling/api';
import { accountLine, ERROR_MESSAGES, phaseOf, templateLine, type Phase } from '@/scheduling/model';
import {
  addDays,
  cityOf,
  clockAt,
  dayOf,
  inputOf,
  lengthOf,
  longDay,
  minuteOf,
  minuteOfInput,
  onTheMinute,
  rangeAt,
  zonedInstant,
} from '@/scheduling/time';

const PHASE_LABELS: Readonly<Record<Phase, string>> = { later: 'À venir', live: 'En poste', past: 'Fini' };

type Arming = 'cancel' | 'stop' | 'template' | null;

/**
 * One shift (EQ-02): who, where, when, in the zone shown, the agency's and the member's own. Before it starts it
 * changes member or hours, or is cancelled; under way it ends earlier or stops now; once over it is kept as it was.
 * A shift that comes back says so, and its template can be stopped from here. Its report says how it went: the amount,
 * where it stands, and any incident (EQ-03).
 */
export function ShiftSheet({
  shift,
  planning,
  members,
  templates,
  zone,
  now,
  reports,
  onClose,
}: {
  shift: Shift;
  planning: Planning;
  members: readonly TeamMember[];
  templates: readonly ShiftTemplate[];
  /** The zone the grid is read in. */
  zone: string;
  now: Date;
  /** The shift's report and corrections, `null` while they are not read. */
  reports: readonly ShiftReport[] | null;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshPlanning();
  const agency = planning.settings.timeZone;
  const account = planning.accounts.find((one) => one.id === shift.platformAccountId) ?? null;
  const shown = planning.members.find((one) => one.id === shift.memberId) ?? null;
  const record = members.find((member) => member.id === shift.memberId) ?? null;
  const template = templates.find((one) => one.id === shift.templateId) ?? null;
  const phase = phaseOf(shift, now);
  const report = reports === null ? null : reportOf(reports, shift.id);
  const corrected = reports?.some((one) => one.correctsId !== null && one.status === 'validated') ?? false;
  const startDay = dayOf(shift.startsAt, agency);
  // Who may take it: active, on its creator, and already joined that day (`member_not_joined_conflict`).
  const eligible = members
    .filter(
      (member) =>
        member.status === 'active' &&
        account !== null &&
        member.creatorIds.includes(account.creatorId) &&
        member.joinedOn <= startDay,
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));

  const [memberId, setMemberId] = useState(shift.memberId);
  const [from, setFrom] = useState(inputOf(minuteOf(shift.startsAt, agency)));
  const [to, setTo] = useState(inputOf(minuteOf(shift.endsAt, agency)));
  const [arming, setArming] = useState<Arming>(null);
  const times = useUnreadableTimes();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const run = async (write: () => Promise<Outcome<unknown>>): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    const outcome = await write();
    setBusy(false);
    if (outcome.kind === 'ok') {
      await refresh();
      onClose();
      return;
    }
    setRefusal(outcome);
    // A shift gone meanwhile: the grid is read again under the sheet.
    if (outcome.kind === 'refused' && outcome.code.endsWith('_not_found')) void refresh();
  };

  /**
   * The hours typed, on the shift's day in the agency's time; the end the next day when it comes before the start. Null
   * while a field holds what is not an hour: the sheet never saves an hour other than the one on screen.
   */
  const typed = (): { startsAt: string; endsAt: string } | null => {
    if (times.unreadable) return null;
    const start = minuteOfInput(from);
    const end = minuteOfInput(to);
    if (start === null || end === null || start === end) return null;
    return {
      startsAt: zonedInstant(startDay, start, agency).toISOString(),
      endsAt: zonedInstant(end < start ? addDays(startDay, 1) : startDay, end, agency).toISOString(),
    };
  };

  const save = (): void => {
    const hours = typed();
    // Enter submits the form even while « Enregistrer » is off.
    if (hours === null) return;
    const body: UpdateShiftBody = {};
    if (memberId !== shift.memberId) body.memberId = memberId;
    if (phase === 'later') {
      if (hours.startsAt !== shift.startsAt) body.startsAt = hours.startsAt;
      if (hours.endsAt !== shift.endsAt) body.endsAt = hours.endsAt;
    }
    if (phase === 'live' && hours.endsAt !== shift.endsAt) body.endsAt = hours.endsAt;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    void run(() => updateShift(shift.id, body));
  };

  const hours = typed();
  // Its report, said where the member's reports of its period are: Rapports opens on his fold (EQ-13).
  const toReports = { quinzaine: periodAt(new Date(shift.startsAt), agency), membre: shift.memberId };
  // Another zone is shown only where its hours differ from those above: Porto-Novo and Paris share them in winter.
  const shownRange = rangeAt(shift.startsAt, shift.endsAt, zone);
  const differs = rangeAt(shift.startsAt, shift.endsAt, agency) !== shownRange;
  const home = record?.timeZone ?? null;
  const homeRange = home === null ? null : rangeAt(shift.startsAt, shift.endsAt, home);

  return (
    <Dialog
      title={
        // His name opens his record in Membres (EQ-11).
        <Link to="/equipe/membres" search={{ membre: shift.memberId }} className="sc-sheet__who">
          {shown?.displayName ?? 'Un membre'}
        </Link>
      }
      lead={account === null ? undefined : `${account.creatorName} · ${accountLine(account)}`}
      busy={busy}
      onClose={onClose}
    >
      <div className="tm-dialog__body">
        <div className="sc-sheet__when">
          <span
            className="sc-swatch"
            style={
              shown?.color === undefined || shown.color === null ? undefined : { '--sc-color': shown.color }
            }
            aria-hidden="true"
          />
          <div className="sc-sheet__time">
            <p className="sc-sheet__range nv-num">{shownRange}</p>
            <p className="sc-sheet__day">
              {longDay(dayOf(shift.startsAt, zone)).replace(/^./u, (letter) => letter.toUpperCase())} ·{' '}
              {lengthOf(new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime())}
            </p>
          </div>
          <span className={`nv-status sc-phase sc-phase--${phase}`}>
            <span className={`nv-dot${phase === 'live' ? ' nv-tone--ok nv-dot--live' : ''}`} />
            {PHASE_LABELS[phase]}
          </span>
        </div>
        <ul className="sc-sheet__facts">
          {differs ? (
            <li>
              <span>À {cityOf(agency)}</span>
              <span className="nv-num">{rangeAt(shift.startsAt, shift.endsAt, agency)}</span>
            </li>
          ) : null}
          {home !== null &&
          homeRange !== shownRange &&
          homeRange !== rangeAt(shift.startsAt, shift.endsAt, agency) ? (
            <li>
              <span>
                Chez {shown?.displayName ?? 'le membre'} ({cityOf(home)})
              </span>
              <span className="nv-num">{homeRange}</span>
            </li>
          ) : null}
          {template === null ? null : (
            <li>
              <span>Modèle</span>
              <span className="sc-sheet__repeat">
                {templateLine(template)}
                {arming === 'template' ? null : (
                  <button
                    type="button"
                    className="sc-link"
                    disabled={busy}
                    onClick={() => {
                      setArming('template');
                    }}
                  >
                    Arrêter le modèle
                  </button>
                )}
              </span>
            </li>
          )}
          {shift.stoppedAt === null ? null : (
            <li>
              <span>Arrêté</span>
              <span className="nv-num">{clockAt(shift.stoppedAt, zone)}</span>
            </li>
          )}
          {report !== null ? (
            <li>
              <span>Rapport</span>
              <Link to="/equipe/rapports" search={toReports} className="sc-sheet__report">
                <span className="nv-num">
                  {amountText(report.amount.amountMinor, report.amount.currency)}
                </span>
                <span className={`rp-chip rp-chip--${STATUS_TONES[report.status]}`}>
                  {AGENCY_STATUS[report.status]}
                </span>
              </Link>
            </li>
          ) : reports !== null && phase === 'past' ? (
            <li>
              <span>Rapport</span>
              <Link to="/equipe/rapports" search={toReports} className="sc-sheet__report" data-warn="true">
                Sans rapport
              </Link>
            </li>
          ) : null}
          {report === null || reports === null || !corrected ? null : (
            <li>
              <span>Validé, corrections comprises</span>
              <span className="nv-num">
                {amountText(validatedTotal(reports, shift.id), report.amount.currency)}
              </span>
            </li>
          )}
        </ul>
        {(reports ?? []).map((one) =>
          one.incident === null ? null : (
            <p key={one.id} className="rp-review__incident sc-sheet__incident">
              <span className="rp-review__flag">Incident</span> {one.incident}
            </p>
          ),
        )}

        {phase === 'past' ? null : (
          <form
            className="sc-sheet__edit"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            {phase === 'later' ? (
              <div className="nv-field tm-field">
                <label className="nv-field__label" htmlFor={`${id}-member`}>
                  Membre
                </label>
                <select
                  id={`${id}-member`}
                  className="nv-field__control nv-glass tm-select"
                  value={memberId}
                  onChange={(event) => {
                    const picked = eligible.find((member) => member.id === event.target.value);
                    setMemberId(picked?.id ?? shift.memberId);
                  }}
                >
                  {eligible.some((member) => member.id === shift.memberId) ? null : (
                    <option value={shift.memberId}>{shown?.displayName ?? 'Membre actuel'}</option>
                  )}
                  {eligible.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <fieldset className="sc-fieldset">
              <legend className="nv-field__label">
                {phase === 'live' ? 'Finir plus tôt' : 'Heures'} (à {cityOf(agency)})
              </legend>
              <div className="sc-hours">
                {phase === 'later' ? (
                  <label className="sc-hours__one">
                    <span className="tm-hint">De</span>
                    <TimeField
                      value={minuteOfInput(from) ?? 0}
                      label="Début"
                      onChange={(minute) => {
                        setFrom(inputOf(minute));
                      }}
                      onUnreadable={times.onUnreadable}
                    />
                  </label>
                ) : null}
                <label className="sc-hours__one">
                  <span className="tm-hint">{phase === 'later' ? 'à' : 'Fin à'}</span>
                  <TimeField
                    value={minuteOfInput(to) ?? 0}
                    label="Fin"
                    onChange={(minute) => {
                      setTo(inputOf(minute));
                    }}
                    onUnreadable={times.onUnreadable}
                  />
                </label>
              </div>
              {hours === null ? (
                <span className="tm-hint tm-hint--error">
                  {times.unreadable
                    ? 'Une heure sur 24 heures : 22, 2230 ou 22:30.'
                    : 'Un début et une fin différents.'}
                </span>
              ) : null}
            </fieldset>
            <div className="tm-dialog__foot sc-sheet__foot">
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--destructive"
                disabled={busy}
                onClick={() => {
                  setArming(phase === 'live' ? 'stop' : 'cancel');
                }}
              >
                {phase === 'live' ? 'Arrêter maintenant' : 'Annuler ce shift'}
              </button>
              <button
                type="submit"
                className="nv-btn nv-btn--soft"
                disabled={busy || hours === null}
                aria-busy={busy}
              >
                {busy ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        )}

        {arming === null ? null : (
          <div className="nv-confirm" role="alertdialog" aria-label="Confirmer">
            <p className="sc-confirm__text">
              {arming === 'stop'
                ? `Le shift s’arrête maintenant, et ${account?.creatorName ?? 'sa créatrice'} se ferme pour ${shown?.displayName ?? 'le membre'} dans Nirvana, sans marge.`
                : arming === 'cancel'
                  ? 'Le shift est retiré du planning. Il reste noté au journal, et son modèle ne le refait pas.'
                  : 'Ses shifts pas encore commencés sont annulés ; les autres restent au planning.'}
            </p>
            <div className="nv-confirm__actions">
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                disabled={busy}
                onClick={() => {
                  setArming(null);
                }}
              >
                Garder
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--destructive nv-btn--sm"
                disabled={busy}
                aria-busy={busy}
                onClick={() => {
                  if (arming === 'stop')
                    void run(() => updateShift(shift.id, { endsAt: onTheMinute(new Date()).toISOString() }));
                  else if (arming === 'cancel') void run(() => cancelShift(shift.id));
                  else if (template !== null) void run(() => endTemplate(template.id));
                }}
              >
                {arming === 'stop'
                  ? 'Arrêter'
                  : arming === 'cancel'
                    ? 'Annuler le shift'
                    : 'Arrêter le modèle'}
              </button>
            </div>
          </div>
        )}

        {refusal === null ? null : (
          <p className="tm-warn nv-swap" role="alert">
            {refusal.kind === 'failed'
              ? 'Le serveur ne répond pas : rien n’a changé. Réessaie dans un instant.'
              : ERROR_MESSAGES[refusal.code]}
          </p>
        )}
      </div>
    </Dialog>
  );
}
