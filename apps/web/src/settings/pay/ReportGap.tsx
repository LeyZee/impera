import { ReportGapThresholdSchema, type ReportGapThreshold } from '@impera/contracts';
import { useId, useState, type JSX } from 'react';

import { saveReportGap, useRefreshReports, useReportGap, type ReportRefusal } from '@/reports/api';
import {
  amountInput,
  amountText,
  parseAmount,
  parsePercent,
  percentText,
  refusalText,
} from '@/reports/model';
import '@/reports/reports.css';
import '@/payroll/pay.css';
import { Dialog } from '@/shell/Dialog';
import '@/screens/team/team.css';

const STEPS = ['Remplir', 'Relire'] as const;

/** The contract's bounds, as the fields say them: up to 100 % and 1 000,00 €. */
const MAX_BPS = ReportGapThresholdSchema.shape.bps.maxValue ?? 10_000;
const MAX_MINOR = ReportGapThresholdSchema.shape.minor.maxValue ?? 100_000;

/** « 1 » or « 2,5 »: basis points as the field shows them. */
const percentInput = (bps: number): string => String(bps / 100).replace('.', ',');

/** What a threshold lets through, in one sentence of the card and the recap. */
function thresholdSentence(threshold: ReportGapThreshold): JSX.Element {
  if (threshold.bps === 0 && threshold.minor === 0) {
    return <>seul un rapport égal aux ventes lues se valide tout seul.</>;
  }
  const parts = [
    threshold.bps === 0 ? null : <b className="nv-num">{percentText(threshold.bps)}</b>,
    threshold.minor === 0 ? null : <b className="nv-num">{amountText(threshold.minor, 'EUR')}</b>,
  ];
  const [percent, amount] = parts;
  return (
    <>
      un rapport se valide tout seul s’il n’est pas au-dessus des ventes lues et s’en écarte de {percent}
      {percent !== null && amount !== null ? ' au plus, ou de ' : null}
      {amount} au plus.
    </>
  );
}

/**
 * The threshold in Réglages › Règles de paie (ADR 0073 § 3, owner): a report compared with what its platform read
 * during the shift validates by itself within it, never above the platform; out of it, or above, it waits for its
 * member to correct or explain it, then the agency decides. A change applies to the comparisons read from then on.
 */
export function ReportGap(): JSX.Element {
  const threshold = useReportGap();
  const [open, setOpen] = useState(false);
  const data = threshold.data;

  return (
    <div className="nv-plate rp-account rp-account--setting nv-enter">
      <div className="rp-account__head">
        <div className="rp-account__who">
          <p className="rp-account__name">Seuil d’écart des rapports</p>
          <p className="rp-account__handle">comparés aux ventes lues sur la plateforme</p>
        </div>
        {data === undefined ? null : (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            onClick={() => {
              setOpen(true);
            }}
          >
            Changer
          </button>
        )}
      </div>
      {data === undefined ? (
        threshold.isError ? (
          <div className="rp-account__now">
            <p className="tm-warn">Le serveur ne répond pas : le seuil n’a pas pu être lu.</p>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm tm-self-start"
              onClick={() => {
                void threshold.refetch();
              }}
            >
              Réessayer
            </button>
          </div>
        ) : (
          <div className="sc-skeleton" aria-hidden="true">
            <i />
          </div>
        )
      ) : (
        <div className="rp-account__now">
          <span className="rp-chip rp-chip--ok">En vigueur</span>
          <p className="rp-account__rules nv-num">
            {data.bps === 0 && data.minor === 0
              ? 'Aucun écart'
              : [
                  data.bps === 0 ? null : percentText(data.bps),
                  data.minor === 0 ? null : amountText(data.minor, 'EUR'),
                ]
                  .filter((part) => part !== null)
                  .join(' ou ')}
          </p>
          <p className="rp-account__since">
            Sur un compte dont les ventes sont lues, {thresholdSentence(data)} Au-delà, ou au-dessus, il
            attend que son membre le corrige ou l’explique, 48 heures au plus, puis l’agence décide. Jamais de
            retenue automatique.
          </p>
        </div>
      )}
      {open && data !== undefined ? (
        <GapDialog
          threshold={data}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function GapDialog({
  threshold,
  onClose,
}: {
  threshold: ReportGapThreshold;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshReports();
  const [percent, setPercent] = useState(percentInput(threshold.bps));
  const [amount, setAmount] = useState(amountInput(threshold.minor));
  const [touched, setTouched] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<ReportRefusal | null>(null);
  const bps = parsePercent(percent, MAX_BPS);
  const minor = parseAmount(amount, false, MAX_MINOR);
  const next = bps === null || minor === null ? null : { bps, minor };
  const step = checking ? 1 : 0;

  const send = async (): Promise<void> => {
    if (next === null || busy) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await saveReportGap(next);
    await refresh();
    setBusy(false);
    if (outcome.kind === 'ok') {
      onClose();
      return;
    }
    setRefusal(outcome);
    setChecking(false);
  };

  return (
    <Dialog title="Seuil d’écart" lead="Pour les rapports de toute l’équipe" busy={busy} onClose={onClose}>
      <div className="tm-dialog__body">
        <ol className="tm-steps" aria-label="Étapes">
          {STEPS.map((title, index) => (
            <li
              key={title}
              data-state={index < step ? 'done' : index === step ? 'now' : 'later'}
              aria-current={index === step ? 'step' : undefined}
            >
              <span className="tm-steps__num">{String(index + 1)}</span>
              {title}
            </li>
          ))}
        </ol>
        {checking && next !== null ? (
          <>
            <p className="py-recap nv-enter">À partir de maintenant, {thresholdSentence(next)}</p>
            <p className="tm-hint">
              Les rapports déjà validés gardent le seuil qu’ils ont vu. Un rapport au-dessus des ventes lues
              attend toujours son membre, même d’un centime.
            </p>
            <div className="tm-dialog__foot">
              <button
                type="button"
                className="nv-btn nv-btn--plain"
                disabled={busy}
                onClick={() => {
                  setChecking(false);
                }}
              >
                Modifier
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--neon"
                data-autofocus
                disabled={busy}
                aria-busy={busy}
                onClick={() => {
                  void send();
                }}
              >
                {busy ? 'Enregistrement…' : 'Enregistrer le seuil'}
              </button>
            </div>
          </>
        ) : (
          <form
            className="tm-dialog__body"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setTouched(true);
              if (next !== null) setChecking(true);
            }}
          >
            <div className="nv-field tm-field" data-invalid={touched && bps === null ? 'true' : undefined}>
              <label className="nv-field__label" htmlFor={`${id}-percent`}>
                Écart en pourcentage
              </label>
              <div className="tm-percent">
                <input
                  id={`${id}-percent`}
                  className="nv-field__control nv-glass nv-num"
                  inputMode="decimal"
                  autoComplete="off"
                  data-autofocus
                  value={percent}
                  aria-invalid={touched && bps === null}
                  onChange={(event) => {
                    setPercent(event.target.value);
                  }}
                />
                %
              </div>
              <p className={touched && bps === null ? 'tm-hint tm-hint--error' : 'tm-hint'}>
                {touched && bps === null
                  ? 'Un taux entre 0 et 100, comme 1 ou 2,5.'
                  : 'Des ventes lues pendant le shift.'}
              </p>
            </div>
            <div className="nv-field tm-field" data-invalid={touched && minor === null ? 'true' : undefined}>
              <label className="nv-field__label" htmlFor={`${id}-amount`}>
                Ou écart en montant
              </label>
              <div className="tm-percent">
                <input
                  id={`${id}-amount`}
                  className="nv-field__control nv-glass nv-num"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  aria-invalid={touched && minor === null}
                  onChange={(event) => {
                    setAmount(event.target.value);
                  }}
                />
                €
              </div>
              <p className={touched && minor === null ? 'tm-hint tm-hint--error' : 'tm-hint'}>
                {touched && minor === null
                  ? `Un montant de 0 à ${amountText(MAX_MINOR, 'EUR')}, deux décimales au plus.`
                  : 'Le plus large des deux compte. Sur un compte en dollars, le montant se lit en dollars.'}
              </p>
            </div>
            {refusal === null ? null : (
              <p className="tm-warn sc-refusal nv-swap" role="alert">
                {refusal.kind === 'refused'
                  ? refusalText(refusal)
                  : 'Le serveur ne répond pas : le seuil n’a pas été enregistré.'}
              </p>
            )}
            <div className="tm-dialog__foot">
              <button type="button" className="nv-btn nv-btn--plain" onClick={onClose}>
                Annuler
              </button>
              <button type="submit" className="nv-btn nv-btn--neon">
                Vérifier
              </button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}
