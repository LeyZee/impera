import {
  newId,
  ShiftReportIdSchema,
  type ShiftReport,
  type ShiftReportContext,
  type ShiftReportId,
} from '@nirvana/contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react';

import { useAppHold, type HoldResult } from './Hold';
import { changeReport, makeReport, useRefreshReports, useReportContext, type ReportOutcome } from './api';
import {
  amountInput,
  amountText,
  CURRENCY_SIGNS,
  CURRENCY_WORDS,
  currencyTyped,
  MEMBER_STATUS,
  parseAmount,
  periodLine,
  READ_AGAIN,
  REPORT_ERRORS,
  reportOf,
  signedAmountText,
  STATUS_TONES,
  validatedTotal,
} from './model';
import { useReopen, type ReportDraft, type ReportScreen } from './reopen';

import { accountLine, swapShiftLine } from '@/scheduling/model';
import { clockAt, dayMonth, dayOf, readerZone } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { Dialog } from '@/screens/team/Dialog';

const COMMENT_MAX = 1000;

/**
 * « Faire mon rapport » (EQ-03): at the end of a shift, what it brought in, a word for the agency and an incident if
 * there was one; sent in one gesture and held five seconds by the page (`Hold`). The same panel changes a report still
 * waiting, sends again one that came back, shows a validated one and adds a correction to it. What the account's pay
 * rules say for the period comes first: none yet, or sales read by the connector, and there is nothing to declare.
 */
export function ReportPanel({
  shiftId,
  draft,
  memberName,
  canSetRules = false,
  from,
  onClose,
}: {
  shiftId: string;
  draft: ReportDraft | null;
  /** The member whose report the agency corrects; absent when the member opens their own. */
  memberName?: string;
  /** The agency's reader sets the pay rules (the owner): missing rules lead to them. */
  canSetRules?: boolean;
  /** The screen it opens on, and opens again on after « Annuler » or a refusal, wherever the reader went since. */
  from: ReportScreen;
  onClose: () => void;
}): JSX.Element {
  const context = useReportContext(shiftId);
  const reopen = useReopen();
  const onReopen = (again: ReportDraft): void => {
    reopen({ screen: from, shiftId, memberName: memberName ?? null, draft: again });
  };
  const zone = readerZone();
  const data = context.data;
  const when =
    data === undefined ? undefined : swapShiftLine(data.shift.startsAt, data.shift.endsAt, undefined, zone);

  return (
    <Dialog
      title={titleOf(data, draft, memberName)}
      lead={
        data === undefined ? undefined : (
          <>
            <span className="rp-lead__who">{data.account.creatorName}</span> · {accountLine(data.account)}
            <span className="rp-lead__when nv-num">{when}</span>
          </>
        )
      }
      onClose={onClose}
    >
      {context.isError ? (
        <div className="tm-dialog__body">
          <div className="sc-empty">
            <p className="tm-warn">Le serveur ne répond pas : ce shift n’a pas pu être lu.</p>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              onClick={() => {
                void context.refetch();
              }}
            >
              Réessayer
            </button>
          </div>
        </div>
      ) : data === undefined ? (
        <div className="tm-dialog__body">
          <div className="sc-skeleton" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </div>
      ) : (
        <Body
          data={data}
          draft={draft}
          agency={memberName === undefined ? null : { canSetRules }}
          onClose={onClose}
          onReopen={onReopen}
        />
      )}
    </Dialog>
  );
}

function titleOf(
  data: ShiftReportContext | undefined,
  draft: ReportDraft | null,
  memberName: string | undefined,
): string {
  if (memberName !== undefined) return `Corriger le rapport de ${memberName}`;
  if (draft?.correcting === true) return 'Corriger mon rapport';
  const report = data === undefined ? null : reportOf(data.reports, data.shift.id);
  if (report === null) return 'Faire mon rapport';
  if (report.status === 'validated') return 'Mon rapport';
  if (report.status === 'rejected') return 'Reprendre mon rapport';
  return 'Modifier mon rapport';
}

function Body({
  data,
  draft,
  agency,
  onClose,
  onReopen,
}: {
  data: ShiftReportContext;
  draft: ReportDraft | null;
  /** The agency correcting a member's report, and whether it sets the pay rules; `null` for the member. */
  agency: { readonly canSetRules: boolean } | null;
  onClose: () => void;
  onReopen: (draft: ReportDraft) => void;
}): JSX.Element {
  const now = useNow(15_000);
  const zone = readerZone();
  const [correcting, setCorrecting] = useState(draft?.correcting ?? false);
  const report = reportOf(data.reports, data.shift.id);
  const corrections = data.reports.filter((one) => one.correctsId !== null);

  if (data.rules === null) {
    const missing = `Les règles de paie de ${accountLine(data.account)} ne sont pas posées pour la quinzaine ${periodLine(data.period)}.`;
    if (agency === null) {
      return (
        <Notice tone="warn" onClose={onClose} title="Pas encore de règles de paie">
          {missing} Préviens l’agence : ton rapport se fera dès qu’elles le seront.
        </Notice>
      );
    }
    return (
      <Notice
        tone="warn"
        onClose={onClose}
        title="Pas encore de règles de paie"
        action={
          agency.canSetRules ? (
            <Link to="/reglages/regles-de-paie" className="nv-btn nv-btn--neon" onClick={onClose}>
              Poser les règles
            </Link>
          ) : null
        }
      >
        {missing}{' '}
        {agency.canSetRules
          ? 'Pose-les dans Réglages › Règles de paie : la correction se fera ensuite.'
          : 'Le propriétaire les pose dans Réglages › Règles de paie : la correction se fera ensuite.'}
      </Notice>
    );
  }
  if (data.rules.earningsSource === 'detected') {
    return (
      <Notice tone="info" onClose={onClose} title="Rien à déclarer">
        Sur la quinzaine {periodLine(data.period)}, la paie de ce compte lit les ventes relevées par le
        connecteur : pas de montant à déclarer pour ce shift.
      </Notice>
    );
  }
  if (report === null && now.getTime() < new Date(data.opensAt).getTime()) {
    return (
      <Notice tone="info" onClose={onClose} title={`Le rapport s’ouvre à ${clockAt(data.opensAt, zone)}`}>
        Il se fait à la fin du shift, 30 minutes avant au plus tôt : ce que tu as généré d’ici là y entrera.
      </Notice>
    );
  }
  if (report?.status === 'validated' && !correcting) {
    return (
      <Validated
        report={report}
        today={dayOf(now, zone)}
        corrections={corrections}
        total={validatedTotal(data.reports, data.shift.id)}
        onCorrect={() => {
          setCorrecting(true);
        }}
        onClose={onClose}
      />
    );
  }
  return (
    <Form
      data={data}
      report={correcting ? null : report}
      corrected={correcting ? report : null}
      draft={draft}
      onClose={onClose}
      onReopen={onReopen}
    />
  );
}

function Notice({
  tone,
  title,
  children,
  action = null,
  onClose,
}: {
  tone: 'info' | 'warn';
  title: string;
  children: ReactNode;
  /** What to do about it, beside « Fermer ». */
  action?: ReactNode;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="tm-dialog__body">
      <div className="rp-notice nv-enter" data-tone={tone}>
        <p className="rp-notice__title">{title}</p>
        <p className="rp-notice__text">{children}</p>
      </div>
      <div className="tm-dialog__foot">
        <button
          type="button"
          className={action === null ? 'nv-btn nv-btn--soft' : 'nv-btn nv-btn--plain'}
          data-autofocus
          onClick={onClose}
        >
          Fermer
        </button>
        {action}
      </div>
    </div>
  );
}

/** When the agency validated it: « à 14:32 » the same day, « le mar. 25 oct. à 14:32 » another. */
const validatedWhen = (reviewedAt: string, today: string, zone: string): string => {
  const day = dayOf(reviewedAt, zone);
  return day === today
    ? `à ${clockAt(reviewedAt, zone)}`
    : `le ${dayMonth(day)} à ${clockAt(reviewedAt, zone)}`;
};

/** A validated report: its amount first, then its corrections and their total; a correction is added from here. */
function Validated({
  report,
  today,
  corrections,
  total,
  onCorrect,
  onClose,
}: {
  report: ShiftReport;
  /** The reader's day, which a validation of today leaves unsaid. */
  today: string;
  corrections: readonly ShiftReport[];
  total: number;
  onCorrect: () => void;
  onClose: () => void;
}): JSX.Element {
  const zone = readerZone();
  const { currency } = report.amount;
  return (
    <div className="tm-dialog__body">
      <div className="rp-figure nv-enter">
        <span className={`nv-status rp-status rp-status--${STATUS_TONES[report.status]}`}>
          <span className="nv-dot nv-tone--ok" />
          Validé{report.reviewedAt === null ? '' : ` ${validatedWhen(report.reviewedAt, today, zone)}`}
        </span>
        <p className="rp-figure__value nv-num">{amountText(report.amount.amountMinor, currency)}</p>
        {report.comment === null ? null : <p className="rp-figure__note">« {report.comment} »</p>}
      </div>
      {corrections.length === 0 ? null : (
        <div className="rp-corrections nv-enter" style={{ '--nv-i': 1 }}>
          <p className="nv-eyebrow">Corrections</p>
          <ul className="rp-corrections__list">
            {corrections.map((one) => (
              <li key={one.id} className="rp-correction">
                <span
                  className="rp-correction__amount nv-num"
                  data-sign={one.amount.amountMinor < 0 ? '-' : '+'}
                >
                  {signedAmountText(one.amount.amountMinor, one.amount.currency)}
                </span>
                <span className="rp-correction__why">
                  {one.comment ?? (one.byAgency ? 'Par l’agence' : 'Par toi')}
                </span>
                <span className={`rp-chip rp-chip--${STATUS_TONES[one.status]}`}>
                  {MEMBER_STATUS[one.status]}
                </span>
              </li>
            ))}
          </ul>
          <p className="rp-corrections__total">
            Total validé <span className="nv-num">{amountText(total, currency)}</span>
          </p>
        </div>
      )}
      <p className="tm-hint">
        Un rapport validé ne change plus. S’il y manque une vente ou s’il y en a une de trop, ajoute une
        correction : l’agence la valide comme un rapport.
      </p>
      <div className="tm-dialog__foot">
        <button type="button" className="nv-btn nv-btn--plain" onClick={onCorrect}>
          Ajouter une correction
        </button>
        <button type="button" className="nv-btn nv-btn--soft" data-autofocus onClick={onClose}>
          Fermer
        </button>
      </div>
    </div>
  );
}

/**
 * The three fields, the amount first and large. A report says 0 or more; a correction adds or takes off, its sign
 * said, and never takes the shift's validated total below 0. The amount stays in the currency of the account's rules.
 */
function Form({
  data,
  report,
  corrected,
  draft,
  onClose,
  onReopen,
}: {
  data: ShiftReportContext;
  report: ShiftReport | null;
  corrected: ShiftReport | null;
  draft: ReportDraft | null;
  onClose: () => void;
  onReopen: (draft: ReportDraft) => void;
}): JSX.Element {
  const id = useId();
  const hold = useAppHold();
  const form = useRef<HTMLFormElement>(null);
  const refresh = useRefreshReports();
  const correcting = corrected !== null;
  const currency = data.rules?.currency ?? 'EUR';
  const [reportId] = useState<ShiftReportId>(() => draft?.id ?? newId(ShiftReportIdSchema));
  const [amount, setAmount] = useState(
    () => draft?.amount ?? (report === null ? '' : amountInput(report.amount.amountMinor)),
  );
  const [comment, setComment] = useState(() => draft?.comment ?? report?.comment ?? '');
  const [incidentOn, setIncidentOn] = useState(
    () => draft?.incidentOn ?? (report?.incident ?? null) !== null,
  );
  const [incident, setIncident] = useState(() => draft?.incident ?? report?.incident ?? '');
  const [touched, setTouched] = useState(draft !== null);
  /** How many sends found something to fix: each takes the reader to the first field to fix. */
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (tries === 0) return;
    const target = form.current?.querySelector<HTMLElement>(
      '[data-invalid="true"] input, [data-invalid="true"] textarea',
    );
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target?.focus({ preventScroll: true });
  }, [tries]);

  const typed = currencyTyped(amount);
  const minor = typed === null || typed === currency ? parseAmount(amount, correcting) : null;
  const total = validatedTotal(data.reports, data.shift.id);
  const amountProblem =
    typed !== null && typed !== currency
      ? `Ce compte se déclare ${CURRENCY_WORDS[currency]} : tape le montant seul, sans devise.`
      : minor === null
        ? correcting
          ? 'Un montant à ajouter ou retirer, comme 20 ou −15,50.'
          : 'Un montant comme 120 ou 85,50, 0 si le shift n’a rien vendu.'
        : correcting && minor === 0
          ? 'Une correction ajoute ou retire : 0 ne change rien.'
          : correcting && total + minor < 0
            ? `Le total validé du shift (${amountText(total, currency)}) passerait sous zéro.`
            : null;
  const incidentProblem =
    incidentOn && incident.trim() === '' ? 'Dis en une phrase ce qui s’est passé.' : null;
  const ready = amountProblem === null && incidentProblem === null && minor !== null;
  const unchanged =
    report !== null &&
    minor === report.amount.amountMinor &&
    (comment.trim() === '' ? null : comment.trim()) === report.comment &&
    (incidentOn ? incident.trim() : null) === report.incident;

  const draftNow = (): ReportDraft => ({ id: reportId, correcting, amount, comment, incidentOn, incident });

  const submit = (): void => {
    setTouched(true);
    if (!ready) {
      setTries((count) => count + 1);
      return;
    }
    // A report still waiting, left as it was: nothing to send.
    if (report?.status === 'submitted' && unchanged) {
      onClose();
      return;
    }
    const mine = draftNow();
    const text = `${correcting ? signedAmountText(minor, currency) : amountText(minor, currency)} · ${data.account.creatorName}`;
    // What is held (« Envoi du rapport dans 5 s »), then what was done.
    const [holding, verb] = correcting
      ? ['Envoi de la correction', 'Correction envoyée']
      : report === null
        ? ['Envoi du rapport', 'Rapport envoyé']
        : report.status === 'rejected'
          ? ['Nouvel envoi du rapport', 'Rapport renvoyé']
          : ['Modification du rapport', 'Rapport modifié'];
    const send = async (): Promise<ReportOutcome<ShiftReport>> => {
      const body = {
        amountMinor: minor,
        comment: comment.trim() === '' ? null : comment.trim(),
        incident: correcting || !incidentOn ? null : incident.trim(),
      };
      return report === null
        ? makeReport({
            id: reportId,
            shiftId: data.shift.id,
            correctsId: corrected?.id ?? null,
            currency,
            ...body,
          })
        : changeReport(report.id, { version: report.version, ...body });
    };
    hold.hold(
      {
        title: holding,
        text,
        onCancel: () => {
          onReopen(mine);
        },
      },
      async (): Promise<HoldResult> => {
        const outcome = await send();
        if (outcome.kind === 'ok') {
          await refresh();
          return { ok: true, title: verb, text: `${text} · en attente de validation` };
        }
        if (outcome.kind === 'refused' && READ_AGAIN.has(outcome.code)) await refresh();
        return {
          ok: false,
          title: correcting ? 'Correction non envoyée' : 'Rapport non envoyé',
          text:
            outcome.kind === 'failed'
              ? 'Le serveur ne répond pas : rien n’a été envoyé.'
              : REPORT_ERRORS[outcome.code],
          action: {
            label: 'Rouvrir',
            run: () => {
              onReopen(mine);
            },
          },
        };
      },
    );
    onClose();
  };

  return (
    <form
      ref={form}
      className="tm-dialog__body"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {report?.status === 'rejected' && report.reviewNote !== null ? (
        <div className="rp-notice nv-enter" data-tone="warn">
          <p className="rp-notice__title">Renvoyé par l’agence</p>
          <p className="rp-notice__text">« {report.reviewNote} »</p>
        </div>
      ) : null}
      {correcting ? (
        <p className="tm-hint">
          Validé : <span className="nv-num">{amountText(total, currency)}</span>. Indique ce qui manque (20)
          ou ce qui est en trop (−20).
        </p>
      ) : null}

      <div
        className="nv-field rp-amount"
        data-invalid={touched && amountProblem !== null ? 'true' : undefined}
      >
        <label className="nv-field__label" htmlFor={`${id}-amount`}>
          {correcting ? 'À ajouter ou retirer' : 'Ce que tu as généré'}
        </label>
        <div className="rp-amount__box">
          <input
            id={`${id}-amount`}
            className="nv-field__control nv-glass rp-amount__input nv-num"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="send"
            placeholder={correcting ? '+0,00' : '0,00'}
            value={amount}
            data-autofocus
            aria-invalid={touched && amountProblem !== null}
            aria-describedby={`${id}-amount-hint`}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
            onBlur={() => {
              if (amount !== '') setTouched(true);
            }}
          />
          <span className="rp-amount__sign" aria-hidden="true">
            {CURRENCY_SIGNS[currency]}
          </span>
        </div>
        <p
          id={`${id}-amount-hint`}
          className={touched && amountProblem !== null ? 'tm-hint tm-hint--error' : 'tm-hint'}
        >
          {touched && amountProblem !== null
            ? amountProblem
            : correcting
              ? 'Une vente oubliée, un remboursement : la correction se valide ensuite comme un rapport.'
              : `Le brut de tes ventes sur ce shift, en ${currency === 'EUR' ? 'euros' : 'dollars'}, comme la plateforme l’affiche.`}
        </p>
      </div>

      <div className="nv-field tm-field">
        <label className="nv-field__label" htmlFor={`${id}-comment`}>
          {correcting ? 'Pourquoi' : 'Un mot pour l’agence'} <span className="sc-optional">facultatif</span>
        </label>
        <textarea
          id={`${id}-comment`}
          className="nv-field__control nv-glass sc-note"
          rows={2}
          maxLength={COMMENT_MAX}
          value={comment}
          placeholder={
            correcting
              ? 'Une vente de 20 € oubliée, un remboursement…'
              : 'Un fan à suivre, un pack qui a plu…'
          }
          onChange={(event) => {
            setComment(event.target.value);
          }}
        />
      </div>

      {correcting ? null : (
        <div className="rp-incident" data-on={incidentOn ? 'true' : undefined}>
          <label className="rp-incident__row" htmlFor={`${id}-incident-on`}>
            <span className="rp-incident__text">
              <span className="rp-incident__title">Signaler un incident</span>
              <span className="rp-incident__sub">Un souci de compte, un fan qui inquiète, une coupure…</span>
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
                maxLength={COMMENT_MAX}
                value={incident}
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
      )}

      <div className="tm-dialog__foot">
        <button type="button" className="nv-btn nv-btn--plain" onClick={onClose}>
          Fermer
        </button>
        <button type="submit" className="nv-btn nv-btn--neon" aria-disabled={touched && !ready}>
          {correcting
            ? 'Envoyer la correction'
            : report === null
              ? 'Envoyer mon rapport'
              : report.status === 'rejected'
                ? unchanged
                  ? 'Renvoyer tel quel'
                  : 'Renvoyer'
                : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}
