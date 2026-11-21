import {
  newId,
  REPORT_SIGNAL_CATEGORIES,
  SHIFT_FEEDBACK_SIGNALS_MAX,
  ShiftFeedbackIdSchema,
  type ReportSignalCategory,
  type ShiftFeedback,
  type ShiftReportContext,
} from '@impera/contracts';
import { useId, useState, type JSX } from 'react';

import {
  FEEDBACK_ERRORS,
  incidentStage,
  sendFeedback,
  SIGNAL_CATEGORIES,
  STAGE_WORDS,
  useRefreshFeedbacks,
  useShiftFeedback,
  type IncidentStage,
} from './feedback';
import { periodLine } from './model';

import { clockAt, dayMonth, dayOf } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { Failure } from '@/shell/states';

const TEXT_MAX = 1000;
const SIGNAL_MAX = 280;

interface SignalDraft {
  readonly key: string;
  readonly category: ReportSignalCategory | null;
  readonly text: string;
}

/**
 * The mini feedback of a shift on an account whose pay reads the sales (ADR 0050 § 10, trous béants n° 1): no amount,
 * a word for the agency, an incident, what the creator's week misses, or « Rien à signaler » in one gesture. Sent, it
 * shows where its incident stands: sent, « Vu », « Réglé ».
 */
export function FeedbackPanel({
  data,
  zone,
  onClose,
}: {
  data: ShiftReportContext;
  zone: string;
  onClose: () => void;
}): JSX.Element {
  const read = useShiftFeedback(data.shift.id);
  const now = useNow(15_000);
  if (read.isError) {
    return (
      <div className="tm-dialog__body">
        <Failure
          inline
          onRetry={() => {
            void read.refetch();
          }}
        />
      </div>
    );
  }
  if (read.data === undefined) {
    return (
      <div className="tm-dialog__body">
        <div className="sc-skeleton" aria-hidden="true">
          <i />
          <i />
        </div>
      </div>
    );
  }
  if (read.data.feedback !== null) {
    return <Sent feedback={read.data.feedback} zone={zone} today={dayOf(now, zone)} onClose={onClose} />;
  }
  if (now.getTime() < new Date(data.opensAt).getTime()) {
    return (
      <div className="tm-dialog__body">
        <div className="rp-notice nv-enter">
          <p className="rp-notice__title">Le retour s’ouvre à {clockAt(data.opensAt, zone)}</p>
          <p className="rp-notice__text">
            Sur la quinzaine {periodLine(data.period)}, la paie de ce compte lit les ventes relevées : pas de
            montant à déclarer. À la fin du shift, un mot pour l’agence, ou « Rien à signaler ».
          </p>
        </div>
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--soft" data-autofocus onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    );
  }
  return <Form data={data} onClose={onClose} />;
}

/** When a step was said: « à 14:32 » the same day, « le mar. 25 oct. à 14:32 » another. */
const whenSaid = (instant: string, today: string, zone: string): string => {
  const day = dayOf(instant, zone);
  return day === today ? `à ${clockAt(instant, zone)}` : `le ${dayMonth(day)} à ${clockAt(instant, zone)}`;
};

/** An incident's three steps, as a bar that fills: red while nobody saw it, amber seen, green « Réglé ». */
export function IncidentTrack({
  feedback,
  zone,
  today,
}: {
  feedback: ShiftFeedback;
  zone: string;
  today: string;
}): JSX.Element | null {
  const stage = incidentStage(feedback);
  if (stage === null) return null;
  const order: readonly IncidentStage[] = ['sent', 'seen', 'resolved'];
  const reached = order.indexOf(stage);
  const at: Readonly<Record<IncidentStage, string | null>> = {
    sent: null,
    seen: feedback.incidentSeenAt,
    resolved: feedback.incidentResolvedAt,
  };
  // Three equal steps, each word and its time centred under its own segment (Design, #992).
  return (
    <ol
      className="rp-track"
      data-stage={stage}
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={3}
      aria-valuenow={reached + 1}
      aria-valuetext={STAGE_WORDS[stage]}
    >
      {order.map((one, index) => {
        const said = at[one];
        return (
          <li key={one} className="rp-track__step" data-done={index <= reached ? 'true' : undefined}>
            <span className="rp-track__seg" aria-hidden="true" />
            <span className="rp-track__word">{STAGE_WORDS[one]}</span>
            {said === null ? null : (
              <span className="rp-track__when nv-num">{whenSaid(said, today, zone)}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The signals of a feedback, each in its category's colour. */
export function SignalChips({ feedback }: { feedback: Pick<ShiftFeedback, 'signals'> }): JSX.Element | null {
  if (feedback.signals.length === 0) return null;
  return (
    <ul className="rp-signals">
      {feedback.signals.map((signal, index) => {
        const category = SIGNAL_CATEGORIES[signal.category];
        return (
          <li key={index} className="rp-signal" data-kind={category.kind}>
            <span className="rp-signal__cat">{category.label}</span>
            <span className="rp-signal__text">{signal.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Sent({
  feedback,
  zone,
  today,
  onClose,
}: {
  feedback: ShiftFeedback;
  zone: string;
  today: string;
  onClose: () => void;
}): JSX.Element {
  const stage = incidentStage(feedback);
  return (
    <div className="tm-dialog__body">
      <div className="rp-figure nv-enter">
        <span className="nv-status rp-status rp-status--ok">
          <span className="nv-dot nv-tone--ok" />
          {feedback.nothingToReport ? 'Rien à signaler, envoyé' : 'Retour envoyé'}
        </span>
        {feedback.comment === null ? null : <p className="rp-figure__note">« {feedback.comment} »</p>}
        <SignalChips feedback={feedback} />
      </div>
      {feedback.incident === null ? null : (
        <div className="rp-incident-sent nv-enter" style={{ '--nv-i': 1 }} data-stage={stage ?? undefined}>
          <p className="rp-incident-sent__title">Incident signalé</p>
          <p className="rp-incident-sent__text">{feedback.incident}</p>
          <IncidentTrack feedback={feedback} zone={zone} today={today} />
          <p className="tm-hint">
            {stage === 'resolved'
              ? 'L’agence l’a réglé.'
              : stage === 'seen'
                ? 'L’agence l’a vu et s’en occupe.'
                : 'L’agence a été prévenue sur son téléphone.'}
          </p>
        </div>
      )}
      <div className="tm-dialog__foot">
        <button type="button" className="nv-btn nv-btn--soft" data-autofocus onClick={onClose}>
          Fermer
        </button>
      </div>
    </div>
  );
}

function Form({ data, onClose }: { data: ShiftReportContext; onClose: () => void }): JSX.Element {
  const id = useId();
  const refresh = useRefreshFeedbacks();
  const [feedbackId] = useState(() => newId(ShiftFeedbackIdSchema));
  const [comment, setComment] = useState('');
  const [incidentOn, setIncidentOn] = useState(false);
  const [incident, setIncident] = useState('');
  const [signals, setSignals] = useState<readonly SignalDraft[]>([]);
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const kept = signals.filter((one) => one.text.trim() !== '' || one.category !== null);
  const incidentProblem =
    incidentOn && incident.trim() === '' ? 'Dis en une phrase ce qui s’est passé.' : null;
  const signalProblem = kept.some((one) => one.category === null)
    ? 'Choisis ce que chaque remontée signale.'
    : kept.some((one) => one.text.trim() === '')
      ? 'Écris une phrase pour chaque remontée.'
      : null;
  const said = comment.trim() !== '' || incidentOn || kept.length > 0;
  const ready = incidentProblem === null && signalProblem === null;

  const change = (key: string, next: Partial<Omit<SignalDraft, 'key'>>): void => {
    setSignals((before) => before.map((one) => (one.key === key ? { ...one, ...next } : one)));
  };

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (!ready || sending) return;
    setSending(true);
    setRefusal(null);
    const outcome = await sendFeedback(data.shift.id, {
      id: feedbackId,
      nothingToReport: !said,
      comment: comment.trim() === '' ? null : comment.trim(),
      incident: incidentOn ? incident.trim() : null,
      signals: kept.flatMap((one) =>
        one.category === null ? [] : [{ category: one.category, text: one.text.trim() }],
      ),
    });
    setSending(false);
    if (outcome.kind === 'ok') {
      await refresh();
      return;
    }
    if (outcome.kind === 'refused') {
      if (outcome.code === 'shift_feedback_exists_conflict' || outcome.code === 'shift_feedback_conflict') {
        await refresh();
      }
      setRefusal(FEEDBACK_ERRORS[outcome.code]);
      return;
    }
    setRefusal('Le serveur ne répond pas : rien n’a été envoyé. Réessaie.');
  };

  return (
    <form
      className="tm-dialog__body"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="tm-hint">
        Pas de montant : la paie de ce compte lit les ventes relevées. Un mot pour l’agence, ou rien à
        signaler.
      </p>

      <div className="nv-field tm-field">
        <label className="nv-field__label" htmlFor={`${id}-comment`}>
          Un mot pour l’agence <span className="sc-optional">facultatif</span>
        </label>
        <textarea
          id={`${id}-comment`}
          className="nv-field__control nv-glass sc-note"
          rows={2}
          maxLength={TEXT_MAX}
          value={comment}
          placeholder="Soirée calme, un pack qui a plu…"
          data-autofocus
          onChange={(event) => {
            setComment(event.target.value);
          }}
        />
      </div>

      <div className="rp-incident" data-on={incidentOn ? 'true' : undefined}>
        <label className="rp-incident__row" htmlFor={`${id}-incident-on`}>
          <span className="rp-incident__text">
            <span className="rp-incident__title">Signaler un incident</span>
            <span className="rp-incident__sub">L’agence est prévenue tout de suite sur son téléphone.</span>
          </span>
          <input
            id={`${id}-incident-on`}
            type="checkbox"
            role="switch"
            className="nv-switch"
            checked={incidentOn}
            onChange={(event) => {
              setIncidentOn(event.target.checked);
            }}
          />
        </label>
        {incidentOn ? (
          <div
            className="nv-field tm-field nv-enter"
            data-invalid={touched && incidentProblem !== null ? 'true' : undefined}
          >
            <label className="nv-field__label" htmlFor={`${id}-incident`}>
              Ce qui s’est passé
            </label>
            <textarea
              id={`${id}-incident`}
              className="nv-field__control nv-glass sc-note"
              rows={3}
              maxLength={TEXT_MAX}
              value={incident}
              placeholder="Un souci de compte, un fan qui inquiète, une coupure…"
              aria-invalid={touched && incidentProblem !== null}
              onChange={(event) => {
                setIncident(event.target.value);
              }}
            />
            {touched && incidentProblem !== null ? (
              <p className="tm-hint tm-hint--error">{incidentProblem}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rp-remontees">
        <p className="nv-field__label">
          Ce qui manque pour la semaine <span className="sc-optional">facultatif</span>
        </p>
        {signals.map((one, index) => (
          <div key={one.key} className="rp-remontee nv-enter">
            <div className="rp-remontee__cats" role="group" aria-label={`Remontée ${String(index + 1)}`}>
              {REPORT_SIGNAL_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  className="rp-cat"
                  data-kind={SIGNAL_CATEGORIES[category].kind}
                  aria-pressed={one.category === category}
                  onClick={() => {
                    change(one.key, { category });
                  }}
                >
                  {SIGNAL_CATEGORIES[category].label}
                </button>
              ))}
            </div>
            <div className="rp-remontee__line">
              <input
                className="nv-field__control nv-glass"
                maxLength={SIGNAL_MAX}
                value={one.text}
                placeholder="Un fan demande une vidéo en extérieur…"
                aria-label={`Ce que signale la remontée ${String(index + 1)}`}
                onChange={(event) => {
                  change(one.key, { text: event.target.value });
                }}
              />
              <button
                type="button"
                className="nv-btn nv-btn--plain"
                onClick={() => {
                  setSignals((before) => before.filter((other) => other.key !== one.key));
                }}
              >
                Retirer
              </button>
            </div>
          </div>
        ))}
        {touched && signalProblem !== null ? <p className="tm-hint tm-hint--error">{signalProblem}</p> : null}
        {signals.length < SHIFT_FEEDBACK_SIGNALS_MAX ? (
          <button
            type="button"
            className="nv-btn nv-btn--soft rp-remontees__add"
            onClick={() => {
              setSignals((before) => [
                ...before,
                { key: newId(ShiftFeedbackIdSchema), category: null, text: '' },
              ]);
            }}
          >
            Ajouter une remontée
          </button>
        ) : null}
        <p className="tm-hint">
          Une demande de fan, un script ou un contenu qui manque. Jamais le nom d’un fan.
        </p>
      </div>

      {refusal === null ? null : (
        <div className="rp-notice nv-enter" data-tone="warn" role="alert">
          <p className="rp-notice__title">Retour non envoyé</p>
          <p className="rp-notice__text">{refusal}</p>
        </div>
      )}

      <div className="tm-dialog__foot">
        <button type="button" className="nv-btn nv-btn--plain" onClick={onClose}>
          Fermer
        </button>
        <button
          type="submit"
          className="nv-btn nv-btn--neon"
          aria-disabled={sending || (touched && !ready)}
          aria-busy={sending}
        >
          {said ? 'Envoyer mon retour' : 'Rien à signaler'}
        </button>
      </div>
    </form>
  );
}
