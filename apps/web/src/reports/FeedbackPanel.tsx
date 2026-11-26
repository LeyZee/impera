import {
  DRAFT_REASONS,
  draftReasonAsked,
  newId,
  REPORT_SIGNAL_CATEGORIES,
  SHIFT_FEEDBACK_SIGNALS_MAX,
  ShiftFeedbackIdSchema,
  type ConversationId,
  type DraftReason,
  type ReportSignalCategory,
  type ShiftDigest,
  type ShiftFeedback,
  type ShiftReportContext,
} from '@impera/contracts';
import { useId, useState, type JSX } from 'react';

import {
  DRAFT_REASON_WORDS,
  FEEDBACK_ERRORS,
  incidentStage,
  sendFeedback,
  SIGNAL_CATEGORIES,
  STAGE_WORDS,
  useRefreshFeedbacks,
  useShiftFeedback,
  type IncidentStage,
} from './feedback';
import { amountText, periodLine } from './model';

import { clockAt, dayMonth, dayOf } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { Steps } from '@/shell/figures/figures';
import { Failure } from '@/shell/states';
import '@/scheduling/exchanges.css';

const TEXT_MAX = 1000;
const SIGNAL_MAX = 280;
/** The fans « Lier à un fan » shows at first; the others behind one tap. */
const FANS_SHOWN = 4;

interface SignalDraft {
  readonly key: string;
  readonly category: ReportSignalCategory | null;
  readonly text: string;
  /** « Lier à un fan » (ADR 0170 § 2): a fan of his shift, picked, never typed. */
  readonly fan: ConversationId | null;
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
  return <Form data={data} digest={read.data.digest} zone={zone} onClose={onClose} />;
}

/** When a step was said: « à 14:32 » the same day, « le mar. 25 oct. à 14:32 » another. */
const whenSaid = (instant: string, today: string, zone: string): string => {
  const day = dayOf(instant, zone);
  return day === today ? `à ${clockAt(instant, zone)}` : `le ${dayMonth(day)} à ${clockAt(instant, zone)}`;
};

/** Each step's colour: red while nobody saw it, amber once seen, green when settled (Design, #1008). */
const STAGE_COLOURS: Readonly<Record<IncidentStage, string>> = {
  sent: 'var(--nv-danger)',
  seen: 'var(--nv-warning)',
  resolved: 'var(--nv-success)',
};

/** An incident's three steps, the system's `Steps`: each reached one ticked, with the time it was said. */
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
  const at: Readonly<Record<IncidentStage, string | null>> = {
    sent: null,
    seen: feedback.incidentSeenAt,
    resolved: feedback.incidentResolvedAt,
  };
  return (
    <Steps
      steps={order.map((one) => {
        const said = at[one];
        return { label: STAGE_WORDS[one], when: said === null ? null : whenSaid(said, today, zone) };
      })}
      reached={order.indexOf(stage)}
      label={`Incident : ${STAGE_WORDS[stage]}`}
      colour={STAGE_COLOURS[stage]}
    />
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
            <span className="nv-tag nv-tag--tint rp-signal__cat">{category.label}</span>
            <span className="rp-signal__text">{signal.text}</span>
            {signal.conversationId === null ? null : (
              <span className="rp-signal__fan">dans la fiche du fan</span>
            )}
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

const CHECK = (
  <svg className="rp-option-check" viewBox="0 0 16 16" aria-hidden="true">
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);

/** One choice of a closed list, the planning's `sc-option` with its tick. */
function Choice({
  title,
  sub,
  on,
  lead,
  onPick,
}: {
  title: string;
  sub?: string;
  on: boolean;
  lead?: JSX.Element;
  onPick: () => void;
}): JSX.Element {
  return (
    <button type="button" role="radio" className="sc-option" aria-checked={on} onClick={onPick}>
      {lead}
      <span className="sc-option__text">
        <span className="sc-option__title">{title}</span>
        {sub === undefined ? null : <span className="sc-option__sub">{sub}</span>}
      </span>
      <span className="rp-option-tick">{on ? CHECK : null}</span>
    </button>
  );
}

/** His shift in figures (ADR 0170 § 1): read by Impera, nothing to type. */
function ShiftFigures({ digest }: { digest: ShiftDigest }): JSX.Element {
  const { sales, drafts } = digest;
  const figures: readonly (readonly [string, string, string])[] = [
    sales.feed === 'read'
      ? [
          'sales',
          String(sales.count),
          `${sales.count === 1 ? 'vente' : 'ventes'} · ${amountText(sales.grossInclVatMinor, sales.currency)}`,
        ]
      : ['sales', '–', 'ventes non relevées'],
    ['as-is', String(drafts.asIs), drafts.asIs === 1 ? 'brouillon tel quel' : 'brouillons tels quels'],
    [
      'edited',
      String(drafts.edited + drafts.rejected),
      drafts.edited + drafts.rejected === 1 ? 'brouillon corrigé ou jeté' : 'brouillons corrigés ou jetés',
    ],
    ['handoffs', String(digest.handoffs), digest.handoffs === 1 ? 'passation' : 'passations'],
  ];
  return (
    <div>
      <p className="nv-field__label">
        Ton shift en chiffres <span className="sc-optional">lu par Impera, rien à saisir</span>
      </p>
      <div className="rp-figs">
        {figures.map(([key, value, words]) => (
          <div key={key} className="rp-fig">
            <b className="nv-num">{value}</b>
            <span>{words}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Form({
  data,
  digest,
  zone,
  onClose,
}: {
  data: ShiftReportContext;
  digest: ShiftDigest;
  zone: string;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshFeedbacks();
  const [feedbackId] = useState(() => newId(ShiftFeedbackIdSchema));
  const [comment, setComment] = useState('');
  const [incidentOn, setIncidentOn] = useState(false);
  const [incident, setIncident] = useState('');
  const [signals, setSignals] = useState<readonly SignalDraft[]>([]);
  const [reason, setReason] = useState<DraftReason | null>(null);
  const asked = draftReasonAsked(digest.drafts);
  const changed = digest.drafts.edited + digest.drafts.rejected;
  const allDrafts = changed + digest.drafts.asIs;
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
        one.category === null
          ? []
          : [{ category: one.category, text: one.text.trim(), conversationId: one.fan }],
      ),
      draftReason: asked ? reason : null,
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
      <ShiftFigures digest={digest} />

      {asked ? (
        <div>
          <p className="nv-field__label" id={`${id}-reason`}>
            Tu as corrigé ou jeté {changed} brouillons sur {allDrafts}. Surtout parce qu’ils étaient…{' '}
            <span className="sc-optional">facultatif</span>
          </p>
          <div className="sc-options" role="radiogroup" aria-labelledby={`${id}-reason`}>
            {DRAFT_REASONS.map((one) => (
              <Choice
                key={one}
                title={DRAFT_REASON_WORDS[one]}
                on={reason === one}
                onPick={() => {
                  setReason((before) => (before === one ? null : one));
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

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
          <span className="rp-incident__badge" aria-hidden="true">
            <RpIcon name="alert" />
          </span>
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
          Ce qui remonte <span className="sc-optional">facultatif</span>
        </p>
        {signals.map((one, index) => (
          <div key={one.key} className="rp-remontee nv-enter">
            <div className="rp-remontee__cats" role="group" aria-label={`Remontée ${String(index + 1)}`}>
              {REPORT_SIGNAL_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  className="nv-chip rp-cat"
                  data-kind={SIGNAL_CATEGORIES[category].kind}
                  aria-pressed={one.category === category}
                  onClick={() => {
                    change(one.key, { category });
                  }}
                >
                  <span className="rp-cat__dot" aria-hidden="true" />
                  {SIGNAL_CATEGORIES[category].label}
                </button>
              ))}
            </div>
            <div className="rp-remontee__line">
              <textarea
                className="nv-field__control nv-glass sc-note"
                rows={2}
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
                className="nv-btn nv-btn--plain nv-btn--sm rp-icon-btn"
                onClick={() => {
                  setSignals((before) => before.filter((other) => other.key !== one.key));
                }}
              >
                <RpIcon name="remove" />
                Retirer
              </button>
            </div>
            {digest.fans.length === 0 ? null : (
              <FanPick
                fans={digest.fans}
                zone={zone}
                picked={one.fan}
                label={`Lier la remontée ${String(index + 1)} à un fan de ton shift`}
                onPick={(fan) => {
                  change(one.key, { fan });
                }}
              />
            )}
          </div>
        ))}
        {touched && signalProblem !== null ? <p className="tm-hint tm-hint--error">{signalProblem}</p> : null}
        {signals.length < SHIFT_FEEDBACK_SIGNALS_MAX ? (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm rp-remontees__add rp-icon-btn"
            onClick={() => {
              setSignals((before) => [
                ...before,
                { key: newId(ShiftFeedbackIdSchema), category: null, text: '', fan: null },
              ]);
            }}
          >
            <RpIcon name="add" />
            Ajouter une remontée
          </button>
        ) : null}
        <p className="tm-hint">
          Ce qu’Impera ne voit pas : un souci hors du chat, l’agent qui déraille, une idée. Jamais le nom d’un
          fan dans le texte : lie-le plutôt, ce qui le touche va dans sa fiche, marqué «&nbsp;par un
          chatteur&nbsp;».
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

/** The fans of his shift, the last written to first: one picked, or none (a second tap lets go). */
function FanPick({
  fans,
  zone,
  picked,
  label,
  onPick,
}: {
  fans: ShiftDigest['fans'];
  zone: string;
  picked: ConversationId | null;
  label: string;
  onPick: (fan: ConversationId | null) => void;
}): JSX.Element {
  const [all, setAll] = useState(false);
  const shown = all ? fans : fans.slice(0, FANS_SHOWN);
  return (
    <div className="rp-fans">
      <p className="nv-field__label">
        Lier à un fan de ton shift <span className="sc-optional">facultatif</span>
      </p>
      <div className="sc-options" role="radiogroup" aria-label={label}>
        {shown.map((fan) => (
          <Choice
            key={fan.conversationId}
            title={fan.name}
            sub={`${String(fan.messages)} ${fan.messages === 1 ? 'message' : 'messages'}, le dernier à ${clockAt(fan.lastAt, zone)}`}
            on={picked === fan.conversationId}
            lead={
              <span className="nv-avatar nv-avatar--sm" aria-hidden="true">
                {fan.name.trim().charAt(0).toUpperCase() || '•'}
              </span>
            }
            onPick={() => {
              onPick(picked === fan.conversationId ? null : fan.conversationId);
            }}
          />
        ))}
      </div>
      {fans.length > FANS_SHOWN && !all ? (
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm"
          onClick={() => {
            setAll(true);
          }}
        >
          Voir les {fans.length} fans du shift
        </button>
      ) : null}
    </div>
  );
}

/** The form's few pictograms, drawn like the navigation's (round stroke, 24 grid): never an emoji. */
export function RpIcon({ name }: { name: 'add' | 'remove' | 'alert' | 'seen' | 'done' }): JSX.Element {
  return (
    <svg className="rp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === 'add' ? <path d="M12 5v14M5 12h14" /> : null}
      {name === 'remove' ? <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 11v5M13.5 11v5" /> : null}
      {name === 'alert' ? (
        <>
          <path d="M12 3.5 2.8 19.5h18.4z" />
          <path d="M12 10v4.2M12 17.2v.1" />
        </>
      ) : null}
      {name === 'seen' ? (
        <>
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
          <circle cx="12" cy="12" r="2.8" />
        </>
      ) : null}
      {name === 'done' ? <path d="m5 12.5 4.5 4.5L19 7.5" /> : null}
    </svg>
  );
}

/** Where an incident stands, as the system's state pill: red while nobody saw it (it breathes), amber seen, green done. */
export function StagePill({ stage, prefix = '' }: { stage: IncidentStage; prefix?: string }): JSX.Element {
  return (
    <span className="nv-status rp-stage-pill" data-stage={stage}>
      <span className="nv-status__dot" />
      {prefix}
      {STAGE_WORDS[stage]}
    </span>
  );
}
