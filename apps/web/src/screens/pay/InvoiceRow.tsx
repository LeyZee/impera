import {
  InvoiceReasonSchema,
  INVOICE_REASON_MAX,
  PAY_AMOUNT_MAX_MINOR,
  type InvoiceListItem,
  type PayPeriod,
  type UpholdInvoiceContestBody,
} from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import { useId, useState, type JSX, type SyntheticEvent } from 'react';

import { saveFile } from '@/accounting/api';
import {
  acceptInvoice,
  contestInvoice,
  readInvoicePdf,
  refuseContest,
  upholdContest,
  useInvoiceAcceptance,
  useRefreshInvoices,
  type InvoiceOutcome,
  type InvoiceRefusal,
} from '@/invoices/api';
import '@/invoices/invoices.css';
import {
  acceptanceChip,
  answerable,
  deadlineText,
  dueChip,
  dueText,
  eventLine,
  invoiceRefusalText,
  kindLabel,
  pdfRefusalText,
  periodText,
  readsAgain,
  settlementText,
  type InvoiceChip,
} from '@/invoices/model';
import { dayMonthText } from '@/payroll/model';
import { amountText, parseAmount } from '@/reports/model';
import { Dialog } from '@/shell/Dialog';

/**
 * A document of the invoices' lists (EQ-06 lot 8) and what is done from it: the contractor's answer, the owner's end of
 * a contest, its detail. Shared by Commissions › Factures and Paie › Factures; each says only what the server read.
 */

function StateChip({ chip }: { chip: InvoiceChip }): JSX.Element {
  return (
    <span className={chip.tone === 'danger' ? 'rp-chip iv-chip--danger' : `rp-chip rp-chip--${chip.tone}`}>
      {chip.label}
    </span>
  );
}

/** What the reader may do with a document, by who he is: decided by the page, refused anyway by the server. */
export interface RowReader {
  /** The document is the reader's own: he answers it while it waits. */
  readonly contractor: boolean;
  /** The agency's list: its due date in colour, and who it belongs to. */
  readonly agency: boolean;
  /** The owner ends a contest. */
  readonly owner: boolean;
}

export function InvoiceRow({
  item,
  who,
  reader,
  timeZone,
  statementPeriod,
  onAnswer,
  onSettle,
  onDetail,
}: {
  item: InvoiceListItem;
  /** The member, named in the agency's list; `null` in one's own. */
  who: string | null;
  reader: RowReader;
  timeZone: string;
  /** The quinzaine of the statement it leads to, when known; `null` for no link. */
  statementPeriod: PayPeriod | null;
  onAnswer: (answer: 'accept' | 'contest') => void;
  onSettle: () => void;
  onDetail: () => void;
}): JSX.Element {
  const due = reader.agency ? dueChip(item) : null;
  const facts = [
    who,
    periodText(item),
    `${item.kind === 'invoice' ? 'émise' : 'émis'} le ${dayMonthText(item.issuedOn)}`,
    settlementText(item) ?? dueText(item),
    reader.contractor ? deadlineText(item.acceptance, timeZone) : null,
  ].filter((fact) => fact !== null);
  const pdf = usePdf(item);
  const answering = reader.contractor && answerable(item);
  const settling = reader.owner && !reader.contractor && item.acceptance.state === 'contested';

  return (
    <article className="iv-doc" data-due={due === null ? undefined : item.due}>
      <div className="iv-doc__main">
        <p className="iv-doc__name">
          <span className="nv-num">{item.number}</span>
          <span className="iv-doc__kind">{kindLabel(item)}</span>
        </p>
        {/* Each fact whole on its line (« émise le lun. 2 nov. » never cut after « lun. »), the dot kept with the
            one before it. */}
        <p className="iv-doc__sub nv-num">
          {facts.map((fact, index) => (
            <span key={fact} className="iv-doc__fact">
              {fact}
              {index === facts.length - 1 ? '' : '\u00a0·'}
            </span>
          ))}
        </p>
        {item.acceptance.reason === null ? null : (
          <p className="iv-doc__reason">
            <span>{reader.contractor ? 'Ton motif' : 'Motif du prestataire'} : </span>«&nbsp;
            {item.acceptance.reason}&nbsp;»
          </p>
        )}
      </div>
      <div className="iv-doc__chips">
        <StateChip chip={acceptanceChip(item, reader.contractor)} />
        {due === null ? null : <StateChip chip={due} />}
      </div>
      <p className="iv-doc__amount nv-num">
        {amountText(item.inclVatMinor, 'EUR')}
        <small>
          {item.vatMinor === 0 ? 'sans TVA facturée' : `dont ${amountText(item.vatMinor, 'EUR')} de TVA`}
        </small>
      </p>
      <div className="iv-doc__acts">
        {answering ? (
          <>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              onClick={() => {
                onAnswer('accept');
              }}
            >
              J’accepte
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              onClick={() => {
                onAnswer('contest');
              }}
            >
              Je conteste
            </button>
          </>
        ) : null}
        {settling ? (
          <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={onSettle}>
            Trancher
          </button>
        ) : null}
        {item.pdfReady ? (
          <PdfButton pdf={pdf} className="nv-btn nv-btn--plain nv-btn--sm" label="PDF" />
        ) : (
          <span className="iv-doc__wait">PDF en préparation</span>
        )}
        {statementPeriod === null ? null : (
          <Link
            className="nv-btn nv-btn--plain nv-btn--sm"
            to="/paie/quinzaine"
            search={{ quinzaine: statementPeriod, membre: item.memberId }}
          >
            Voir le relevé
          </Link>
        )}
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" onClick={onDetail}>
          Historique
        </button>
        <PdfFailure pdf={pdf} />
      </div>
    </article>
  );
}

/** A write's ending: done, the list read again; refused, its sentence, and the list read again when it lied. */
function useSend(onDone: () => void): {
  busy: boolean;
  refusal: InvoiceRefusal | null;
  send: (write: () => Promise<InvoiceOutcome<unknown>>) => void;
} {
  const refresh = useRefreshInvoices();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<InvoiceRefusal | null>(null);
  const send = (write: () => Promise<InvoiceOutcome<unknown>>): void => {
    setBusy(true);
    setRefusal(null);
    void write().then(async (outcome) => {
      if (outcome.kind === 'ok') {
        await refresh();
        setBusy(false);
        onDone();
        return;
      }
      setBusy(false);
      setRefusal(outcome);
      if (readsAgain(outcome)) await refresh();
    });
  };
  return { busy, refusal, send };
}

function ReasonField({
  id,
  label,
  hint,
  placeholder,
  value,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="nv-field tm-field" data-invalid={invalid ? 'true' : undefined}>
      <label className="nv-field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="nv-field__control nv-glass sc-note"
        rows={3}
        maxLength={INVOICE_REASON_MAX}
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid}
        aria-describedby={`${id}-hint`}
        data-autofocus
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      <p id={`${id}-hint`} className={invalid ? 'tm-hint tm-hint--error' : 'tm-hint'}>
        {invalid ? `Le motif est obligatoire, ${String(INVOICE_REASON_MAX)} caractères au plus.` : hint}
      </p>
    </div>
  );
}

/** The PDF, read before it is saved (recette EQP-08): a refusal is said here, never saved as a file named « pdf.json ». */
interface Pdf {
  readonly busy: boolean;
  readonly failure: string | null;
  readonly read: () => void;
}

function usePdf(item: InvoiceListItem): Pdf {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const read = (): void => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    void readInvoicePdf(item.id).then((outcome) => {
      setBusy(false);
      if (outcome.kind === 'ok') {
        saveFile(outcome.value, `${item.number}.pdf`);
        return;
      }
      setFailure(pdfRefusalText(outcome));
    });
  };
  return { busy, failure, read };
}

function PdfButton({ pdf, className, label }: { pdf: Pdf; className: string; label: string }): JSX.Element {
  return (
    <button type="button" className={className} disabled={pdf.busy} aria-busy={pdf.busy} onClick={pdf.read}>
      {pdf.busy ? 'Lecture…' : label}
    </button>
  );
}

function PdfFailure({ pdf }: { pdf: Pdf }): JSX.Element | null {
  return pdf.failure === null ? null : (
    <p className="tm-warn sc-refusal iv-doc__failure nv-swap" role="alert">
      {pdf.failure}
    </p>
  );
}

function Refusal({ refusal }: { refusal: InvoiceRefusal | null }): JSX.Element | null {
  return refusal === null ? null : (
    <p className="tm-warn sc-refusal nv-swap" role="alert">
      {invoiceRefusalText(refusal)}
    </p>
  );
}

/** « J'accepte » or « Je conteste », the contractor's answer: final, so said before it leaves. */
export function AnswerDialog({
  item,
  answer,
  onClose,
}: {
  item: InvoiceListItem;
  answer: 'accept' | 'contest';
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const { busy, refusal, send } = useSend(onClose);
  const pdf = usePdf(item);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const valid = InvoiceReasonSchema.safeParse(reason).success;
  const what = `${kindLabel(item).toLowerCase()} ${item.number}`;

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (busy) return;
    if (answer === 'accept') {
      send(() => acceptInvoice(item.id));
      return;
    }
    setTouched(true);
    if (valid) send(() => contestInvoice(item.id, { reason: reason.trim() }));
  };

  return (
    <Dialog
      title={answer === 'accept' ? `Accepter la ${what}` : `Contester la ${what}`}
      lead={`${amountText(item.inclVatMinor, 'EUR')}, ${periodText(item)}.`}
      busy={busy}
      onClose={onClose}
    >
      <form className="tm-dialog__body" noValidate onSubmit={submit}>
        {answer === 'accept' ? (
          <p className="tm-hint">
            Tu confirmes que ce document dit juste. Ta réponse est définitive : relis le PDF avant si tu as un
            doute.
          </p>
        ) : (
          <ReasonField
            id={`${id}-reason`}
            label="Ce qui ne va pas"
            hint="Lu par le propriétaire, qui tranche. Jamais le message ni le nom d’un fan."
            placeholder="Le montant ne compte pas mon rapport du 12 octobre."
            value={reason}
            invalid={touched && !valid}
            onChange={setReason}
          />
        )}
        <Refusal refusal={refusal} />
        <PdfFailure pdf={pdf} />
        <div className="tm-dialog__foot">
          {item.pdfReady ? (
            <PdfButton pdf={pdf} className="nv-btn nv-btn--plain" label="Relire le PDF" />
          ) : null}
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
            {busy ? 'Envoi…' : answer === 'accept' ? 'J’accepte' : 'Je conteste'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

type Decision = 'refuse' | 'uphold';
type Correction = 'amount' | 'reissue';
type Side = 'contractor' | 'agency';

const DECISIONS: readonly (readonly [Decision, string])[] = [
  ['refuse', 'Refuser la contestation'],
  ['uphold', 'Donner raison'],
];
const SIDES: readonly (readonly [Side, string])[] = [
  ['contractor', 'En faveur du prestataire'],
  ['agency', 'En faveur de l’agence'],
];

/**
 * The owner ends a contest (ADR 0039 § 3): refused with a reason, or upheld with a reason and one correction, an
 * amount excluding VAT whose side is chosen in words, or « Annuler et refacturer » for an invoice. Checked, then sent.
 */
export function SettleDialog({
  item,
  who,
  onClose,
}: {
  item: InvoiceListItem;
  who: string;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const { busy, refusal, send } = useSend(onClose);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [correction, setCorrection] = useState<Correction>('amount');
  const [side, setSide] = useState<Side | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [checking, setChecking] = useState(false);

  const reissue = item.kind === 'invoice' && correction === 'reissue';
  const typed = parseAmount(amount, false, PAY_AMOUNT_MAX_MINOR);
  const amountValid = typed !== null && typed > 0;
  const reasonValid = InvoiceReasonSchema.safeParse(reason).success;
  const ready =
    decision !== null && reasonValid && (decision === 'refuse' || reissue || (side !== null && amountValid));
  const what = `${kindLabel(item).toLowerCase()} ${item.number}`;
  const shown = typed === null ? '' : amountText(typed, 'EUR');

  const body = (): UpholdInvoiceContestBody => ({
    reason: reason.trim(),
    correction:
      reissue || typed === null
        ? { kind: 'reissue' }
        : { kind: 'amount', amountMinor: side === 'agency' ? -typed : typed },
  });

  const recap =
    decision === 'refuse'
      ? `Tu refuses la contestation de ${who} : la ${what} reste telle qu’elle est.`
      : reissue
        ? `Tu donnes raison à ${who} : un avoir annule la ${what}, et une facture rectificative la refait avec son dossier corrigé. Les virements ne bougent pas.`
        : side === 'agency'
          ? `Tu donnes raison à ${who} : un avoir de ${shown} HT sur la facture, à la prochaine validation.`
          : `Tu donnes raison à ${who} : une régularisation de ${shown} HT en sa faveur, sur sa prochaine facture.`;

  if (checking && decision !== null)
    return (
      <Dialog
        title="Vérifier avant d’envoyer"
        lead={`Contestation de la ${what}`}
        busy={busy}
        onClose={onClose}
      >
        <div className="tm-dialog__body">
          <p className="py-recap nv-enter">{recap}</p>
          <p className="tm-hint">
            {decision === 'uphold'
              ? 'La correction va dans sa prochaine quinzaine ouverte ; elle se lit ensuite dans le relevé de cette quinzaine. '
              : ''}
            Motif lu par {who} : «&nbsp;{reason.trim()}&nbsp;». C’est définitif.
          </p>
          <Refusal refusal={refusal} />
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
              disabled={busy}
              aria-busy={busy}
              onClick={() => {
                send(() =>
                  decision === 'refuse'
                    ? refuseContest(item.id, { reason: reason.trim() })
                    : upholdContest(item.id, body()),
                );
              }}
            >
              {busy ? 'Envoi…' : decision === 'refuse' ? 'Refuser' : 'Donner raison'}
            </button>
          </div>
        </div>
      </Dialog>
    );

  return (
    <Dialog
      title={`Contestation de la ${what}`}
      lead={`${who} conteste : « ${item.acceptance.reason ?? ''} »`}
      busy={busy}
      onClose={onClose}
    >
      <form
        className="tm-dialog__body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (ready) setChecking(true);
        }}
      >
        <div className="nv-field tm-field" data-invalid={touched && decision === null ? 'true' : undefined}>
          <span className="nv-field__label" id={`${id}-decision`}>
            Ta réponse
          </span>
          <div className="tm-choices" role="radiogroup" aria-labelledby={`${id}-decision`}>
            {DECISIONS.map(([one, label]) => (
              <button
                key={one}
                type="button"
                role="radio"
                className="nv-chip"
                aria-checked={decision === one}
                onClick={() => {
                  setDecision(one);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {touched && decision === null ? (
            <p className="tm-hint tm-hint--error">Choisis ta réponse.</p>
          ) : null}
        </div>
        {decision === 'uphold' ? (
          <>
            {item.kind === 'invoice' ? (
              <div className="nv-field tm-field">
                <span className="nv-field__label" id={`${id}-correction`}>
                  La correction
                </span>
                <div className="tm-choices" role="radiogroup" aria-labelledby={`${id}-correction`}>
                  {(
                    [
                      ['amount', 'Corriger le montant'],
                      ['reissue', 'Annuler et refacturer'],
                    ] as const
                  ).map(([one, label]) => (
                    <button
                      key={one}
                      type="button"
                      role="radio"
                      className="nv-chip"
                      aria-checked={correction === one}
                      onClick={() => {
                        setCorrection(one);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="tm-hint">
                  {reissue
                    ? 'Pour une erreur de texte : un nom, une adresse, un identifiant, une mention. Corrige d’abord son dossier.'
                    : 'Pour une somme fausse : un seul montant, hors taxes.'}
                </p>
              </div>
            ) : null}
            {reissue ? null : (
              <>
                <div
                  className="nv-field tm-field"
                  data-invalid={touched && side === null ? 'true' : undefined}
                >
                  <span className="nv-field__label" id={`${id}-side`}>
                    Le sens
                  </span>
                  <div className="tm-choices" role="radiogroup" aria-labelledby={`${id}-side`}>
                    {SIDES.map(([one, label]) => (
                      <button
                        key={one}
                        type="button"
                        role="radio"
                        className="nv-chip"
                        aria-checked={side === one}
                        onClick={() => {
                          setSide(one);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className={touched && side === null ? 'tm-hint tm-hint--error' : 'tm-hint'}>
                    {touched && side === null
                      ? 'Choisis en faveur de qui.'
                      : side === 'agency'
                        ? 'Un avoir sur la facture, à la prochaine validation.'
                        : side === 'contractor'
                          ? 'Une ligne de sa prochaine facture.'
                          : 'Une somme trop basse se rend au prestataire, une somme trop haute revient à l’agence.'}
                  </p>
                </div>
                <div
                  className="nv-field rp-amount"
                  data-invalid={touched && !amountValid ? 'true' : undefined}
                >
                  <label className="nv-field__label" htmlFor={`${id}-amount`}>
                    Montant hors taxes
                  </label>
                  <div className="rp-amount__box">
                    <input
                      id={`${id}-amount`}
                      className="nv-field__control nv-glass rp-amount__input nv-num"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0,00"
                      value={amount}
                      aria-invalid={touched && !amountValid}
                      aria-describedby={`${id}-amount-hint`}
                      onChange={(event) => {
                        setAmount(event.target.value);
                      }}
                    />
                    <span className="rp-amount__sign" aria-hidden="true">
                      €
                    </span>
                  </div>
                  <p
                    id={`${id}-amount-hint`}
                    className={touched && !amountValid ? 'tm-hint tm-hint--error' : 'tm-hint'}
                  >
                    {touched && !amountValid
                      ? `Un montant en euros, plus de 0 et jusqu’à ${amountText(PAY_AMOUNT_MAX_MINOR, 'EUR')}, deux décimales au plus.`
                      : 'Il va dans sa prochaine quinzaine ouverte.'}
                  </p>
                </div>
              </>
            )}
          </>
        ) : null}
        {decision === null ? null : (
          <ReasonField
            id={`${id}-reason`}
            label="Motif"
            hint={`Lu par ${who} avec sa facture. Jamais le message ni le nom d’un fan.`}
            placeholder={
              decision === 'refuse'
                ? 'Le rapport du 12 octobre a été validé sur la quinzaine suivante.'
                : 'Le rapport du 12 octobre manquait au relevé.'
            }
            value={reason}
            invalid={touched && !reasonValid}
            onChange={setReason}
          />
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
    </Dialog>
  );
}

/** A document's totals and each dated step of its life, the reasons with them: the owner's answer to a contest too. */
export function DetailDialog({
  item,
  who,
  timeZone,
  onClose,
}: {
  item: InvoiceListItem;
  who: string | null;
  timeZone: string;
  onClose: () => void;
}): JSX.Element {
  const view = useInvoiceAcceptance(item.id);
  const pdf = usePdf(item);
  return (
    <Dialog
      title={`${kindLabel(item)} ${item.number}`}
      lead={[who, periodText(item)].filter((part) => part !== null).join(' · ')}
      onClose={onClose}
    >
      <div className="tm-dialog__body">
        <dl className="iv-totals nv-num">
          <dt>Hors taxes</dt>
          <dd>{amountText(item.exclVatMinor, 'EUR')}</dd>
          <dt>TVA</dt>
          <dd>{amountText(item.vatMinor, 'EUR')}</dd>
          <dt>Total</dt>
          <dd>{amountText(item.inclVatMinor, 'EUR')}</dd>
        </dl>
        {view.isError ? (
          <div className="sc-empty">
            <p className="tm-warn">Le serveur ne répond pas : l’historique n’a pas pu être lu.</p>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              onClick={() => {
                void view.refetch();
              }}
            >
              Réessayer
            </button>
          </div>
        ) : view.data === undefined ? (
          <p className="tm-hint">Lecture de l’historique…</p>
        ) : (
          <ol className="iv-steps" aria-label="Historique">
            {view.data.events.map((event) => (
              <li key={event.id}>
                <span>{eventLine(event, item.kind, timeZone)}</span>
                {event.reason === null ? null : (
                  <span className="iv-steps__reason">«&nbsp;{event.reason}&nbsp;»</span>
                )}
              </li>
            ))}
          </ol>
        )}
        <PdfFailure pdf={pdf} />
        <div className="tm-dialog__foot">
          {item.pdfReady ? <PdfButton pdf={pdf} className="nv-btn nv-btn--plain" label="PDF" /> : null}
          <button type="button" className="nv-btn nv-btn--soft" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </Dialog>
  );
}
