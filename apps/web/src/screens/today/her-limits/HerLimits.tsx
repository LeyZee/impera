import { LIMIT_TEXT_MAX, NewAbsenceBodySchema, NewStopBodySchema } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import { cancelAbsence, readLimitsAgain, tellAbsence, tellStop, useMyLimits, withdrawStop } from './api';
import { absenceWords, refusalWords } from './model';
import './her-limits.css';

import { DayField } from '@/scheduling/DayField';
import { addDays } from '@/scheduling/time';
import { NOT_SENT, type Outcome } from '@/screens/agenda/api';

type Open = 'none' | 'absence' | 'stop';

const failureOf = (outcome: Exclude<Outcome<null>, { kind: 'ok' }>): string =>
  outcome.kind === 'refused' ? refusalWords(outcome.code) : NOT_SENT[outcome.kind];

/**
 * « Prévenir l'agence » (Charles, 21/11, two small screens): « Je serai absente » and « Je ne fais plus quelque
 * chose ». What she tells is seen at once by her team on shift; she can take it back, never by mistake: one tap.
 */
export function HerLimits({ today }: { today: string }): JSX.Element | null {
  const client = useQueryClient();
  const read = useMyLimits();
  const [open, setOpen] = useState<Open>('none');
  const [told, setTold] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const limits = read.data;
  if (limits === undefined) return null;

  const done = async (outcome: Outcome<null>, words: string): Promise<boolean> => {
    if (outcome.kind !== 'ok') {
      setFailed(failureOf(outcome));
      return false;
    }
    setFailed(null);
    setTold(words);
    setOpen('none');
    await readLimitsAgain(client);
    return true;
  };

  return (
    <section className="nv-plate hl-card nv-enter" aria-labelledby="hl-title">
      <div className="hl-head">
        <h2 id="hl-title" className="nv-h2 sc-fans__title">
          Prévenir l’agence
        </h2>
        <p className="hl-lead">Ton équipe le voit tout de suite.</p>
      </div>
      {limits.absences.length + limits.stops.length === 0 ? null : (
        <ul className="hl-list">
          {limits.absences.map((absence) => (
            <li key={absence.id} className="hl-item">
              <span className="hl-item__text">
                <b>{absenceWords(absence, limits.today)}</b>
                {absence.note === null ? null : <span> · {absence.note}</span>}
              </span>
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                onClick={() => {
                  void cancelAbsence(absence.id).then((outcome) => done(outcome, 'Absence annulée.'));
                }}
              >
                Annuler
              </button>
            </li>
          ))}
          {limits.stops.map((stop) => (
            <li key={stop.id} className="hl-item">
              <span className="hl-item__text">
                Tu ne fais plus : <b>{stop.what}</b>
              </span>
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                onClick={() => {
                  void withdrawStop(stop.id).then((outcome) => done(outcome, 'C’est repris.'));
                }}
              >
                Je le refais
              </button>
            </li>
          ))}
        </ul>
      )}
      {told === null ? null : (
        <p className="hl-told" role="status">
          {told}
        </p>
      )}
      {failed === null ? null : (
        <p className="hl-failed" role="alert">
          {failed}
        </p>
      )}
      {open === 'absence' ? (
        <AbsenceForm
          today={today}
          onCancel={() => {
            setOpen('none');
          }}
          onSend={(body) =>
            tellAbsence(body).then((outcome) => done(outcome, 'C’est noté : ton équipe le sait.'))
          }
        />
      ) : open === 'stop' ? (
        <StopForm
          onCancel={() => {
            setOpen('none');
          }}
          onSend={(body) =>
            tellStop(body).then((outcome) => done(outcome, 'C’est noté : ton équipe le sait.'))
          }
        />
      ) : (
        <div className="hl-actions">
          <button
            type="button"
            className="nv-btn nv-btn--soft"
            onClick={() => {
              setTold(null);
              setOpen('absence');
            }}
          >
            Je serai absente
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--soft"
            onClick={() => {
              setTold(null);
              setOpen('stop');
            }}
          >
            Je ne fais plus quelque chose
          </button>
        </div>
      )}
    </section>
  );
}

function AbsenceForm({
  today,
  onCancel,
  onSend,
}: {
  today: string;
  onCancel: () => void;
  onSend: (body: ReturnType<typeof NewAbsenceBodySchema.parse>) => Promise<boolean>;
}): JSX.Element {
  const id = useId();
  // One id for the form: a second tap after a lost answer writes nothing twice.
  const [key] = useState(() => crypto.randomUUID());
  const [from, setFrom] = useState(addDays(today, 1));
  const [to, setTo] = useState(addDays(today, 1));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const body = NewAbsenceBodySchema.safeParse({ id: key, startsOn: from, endsOn: to, note });
  const wrong = !body.success
    ? (body.error.issues[0]?.message ?? null)
    : from < today
      ? 'Pas un jour passé.'
      : null;
  return (
    <form
      className="hl-form"
      aria-label="Je serai absente"
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.success || wrong !== null) return;
        setBusy(true);
        void onSend(body.data).finally(() => {
          setBusy(false);
        });
      }}
    >
      <div className="hl-days">
        <div className="nv-field">
          <label className="nv-field__label" htmlFor={`${id}-from`}>
            Du
          </label>
          <DayField id={`${id}-from`} value={from} today={today} autofocus onChange={setFrom} />
        </div>
        <div className="nv-field">
          <label className="nv-field__label" htmlFor={`${id}-to`}>
            Au (inclus)
          </label>
          <DayField id={`${id}-to`} value={to} today={today} onChange={setTo} />
        </div>
      </div>
      <div className="nv-field">
        <label className="nv-field__label" htmlFor={`${id}-note`}>
          Un mot pour ton équipe (facultatif)
        </label>
        <input
          id={`${id}-note`}
          className="nv-field__control nv-glass"
          value={note}
          maxLength={LIMIT_TEXT_MAX}
          placeholder="Ex. : en voyage, je réponds le soir"
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </div>
      {wrong === null ? null : <p className="hl-failed">{wrong}</p>}
      <div className="hl-actions">
        <button type="submit" className="nv-btn nv-btn--neon" disabled={busy || wrong !== null}>
          Prévenir
        </button>
        <button type="button" className="nv-btn nv-btn--plain" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function StopForm({
  onCancel,
  onSend,
}: {
  onCancel: () => void;
  onSend: (body: ReturnType<typeof NewStopBodySchema.parse>) => Promise<boolean>;
}): JSX.Element {
  const id = useId();
  const [key] = useState(() => crypto.randomUUID());
  const [what, setWhat] = useState('');
  const [busy, setBusy] = useState(false);
  const body = NewStopBodySchema.safeParse({ id: key, what });
  return (
    <form
      className="hl-form"
      aria-label="Je ne fais plus quelque chose"
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.success) return;
        setBusy(true);
        void onSend(body.data).finally(() => {
          setBusy(false);
        });
      }}
    >
      <div className="nv-field">
        <label className="nv-field__label" htmlFor={`${id}-what`}>
          Ce que tu ne fais plus
        </label>
        <textarea
          id={`${id}-what`}
          className="nv-field__control nv-glass hl-what"
          value={what}
          rows={2}
          maxLength={LIMIT_TEXT_MAX}
          placeholder="Ex. : les vidéos en extérieur"
          data-autofocus
          onChange={(event) => {
            setWhat(event.target.value);
          }}
        />
      </div>
      <p className="hl-lead">L’agence met ta fiche à jour. Ton équipe le voit dès maintenant.</p>
      <div className="hl-actions">
        <button type="submit" className="nv-btn nv-btn--neon" disabled={busy || !body.success}>
          Prévenir
        </button>
        <button type="button" className="nv-btn nv-btn--plain" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}
