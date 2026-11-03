import {
  CONTEST_DELAY_MAX_DAYS,
  CONTRACT_TEXT_MAX,
  JOURNAL_ACCOUNT_NAMES,
  type BillingRegime,
  type ContractText,
  type ContractTextKind,
  type JournalAccountName,
  type JournalAccounts,
} from '@impera/contracts';
import { useId, useState, type JSX, type SyntheticEvent } from 'react';

import { accountsBodyOf, accountsDraftOf, type AccountsDraft } from './accounts';
import {
  addContractText,
  saveAccounts,
  useKeepBillingSettings,
  useRefreshPayroll,
  validateRegime,
} from './api';
import { textBodyOf, textDraftOf, type TextDraft } from './regimes';

import { ACCOUNT_HINTS, ACCOUNT_LABELS } from '@/accounting/model';
import { TEXT_NAMES } from '@/contractors/model';
import type { InvoiceRefusal } from '@/invoices/api';
import { invoiceRefusalText } from '@/invoices/model';
import { fullDay } from '@/scheduling/time';
import { Dialog } from '@/shell/Dialog';

/** A refusal of the server, in French, never a raw code. */
function Refusal({ refusal }: { refusal: InvoiceRefusal | null }): JSX.Element | null {
  return refusal === null ? null : (
    <p className="tm-warn sc-refusal nv-swap" role="alert">
      {invoiceRefusalText(refusal)}
    </p>
  );
}

function Foot({ busy, label, onClose }: { busy: boolean; label: string; onClose: () => void }): JSX.Element {
  return (
    <div className="tm-dialog__foot">
      <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
        Annuler
      </button>
      <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
        {busy ? 'Envoi…' : label}
      </button>
    </div>
  );
}

/**
 * The journal's eight accounts and journals (EQ-06 lot 8c): each empty until the accountant gives it, no number ever
 * proposed. An empty field is kept empty, and the export names it in its refusal.
 */
export function AccountsDialog({
  accounts,
  onClose,
}: {
  accounts: JournalAccounts | null;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const keep = useKeepBillingSettings();
  const [draft, setDraft] = useState<AccountsDraft>(() => accountsDraftOf(accounts));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<InvoiceRefusal | null>(null);
  const checked = accountsBodyOf(draft);
  const problemOf = (name: JournalAccountName): string | undefined =>
    tried && !checked.ok ? checked.problems[name] : undefined;

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setTried(true);
    if (!checked.ok || busy) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await saveAccounts(checked.body);
    setBusy(false);
    if (outcome.kind === 'ok') {
      keep(outcome.value);
      onClose();
      return;
    }
    setRefusal(outcome);
  };

  return (
    <Dialog
      title="Comptes du journal"
      lead="Ceux que ton comptable donne, tels qu’il les écrit : un champ vide reste vide, et l’export dit lequel manque."
      busy={busy}
      onClose={onClose}
    >
      <form className="tm-dialog__body bf-accounts" noValidate onSubmit={(event) => void submit(event)}>
        {JOURNAL_ACCOUNT_NAMES.map((name) => {
          const problem = problemOf(name);
          return (
            <div
              key={name}
              className="nv-field tm-field"
              data-invalid={problem === undefined ? undefined : 'true'}
            >
              <label className="nv-field__label" htmlFor={`${id}-${name}`}>
                {ACCOUNT_LABELS[name]}
              </label>
              <input
                id={`${id}-${name}`}
                className="nv-field__control nv-glass nv-num"
                value={draft[name]}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={problem !== undefined}
                aria-describedby={`${id}-${name}-hint`}
                onChange={(event) => {
                  setDraft((before) => ({ ...before, [name]: event.target.value }));
                }}
              />
              <p
                id={`${id}-${name}-hint`}
                className={problem === undefined ? 'tm-hint' : 'tm-hint tm-hint--error'}
              >
                {problem ?? ACCOUNT_HINTS[name]}
              </p>
            </div>
          );
        })}
        <Refusal refusal={refusal} />
        <Foot busy={busy} label="Enregistrer" onClose={onClose} />
      </form>
    </Dialog>
  );
}

/**
 * A new version of the contract or of the mandate: the agency's text as its accountant validated it, pasted as it is,
 * never trimmed (its SHA-256 is the proof of what each contractor accepts). Its key is drawn again at each change, so
 * that a retry of the same text never meets another one under it.
 */
export function TextDialog({
  kind,
  latest,
  onClose,
}: {
  kind: ContractTextKind;
  latest: ContractText | null;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshPayroll();
  const [draft, setDraft] = useState<TextDraft>(() => textDraftOf(latest));
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<InvoiceRefusal | null>(null);
  const checked = textBodyOf(kind, draft, key);
  const problems = tried && !checked.ok ? checked.problems : {};
  const change = (patch: Partial<TextDraft>): void => {
    setDraft((before) => ({ ...before, ...patch }));
    setKey(crypto.randomUUID());
  };

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setTried(true);
    if (!checked.ok || busy) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await addContractText(checked.body);
    setBusy(false);
    if (outcome.kind === 'ok') {
      await refresh();
      onClose();
      return;
    }
    setRefusal(outcome);
  };

  const version = (latest?.version ?? 0) + 1;
  const mandate = kind === 'billing_mandate';
  return (
    <Dialog
      title={`${TEXT_NAMES[kind]}, version ${String(version)}`}
      lead={
        mandate
          ? 'Le texte validé par ton comptable, collé tel quel. Une fois écrit, il ne change plus. Chaque prestataire accepte la nouvelle version dans Moi › Dossier ; d’ici là, ses factures partent avec un avertissement.'
          : 'Le texte validé par ton comptable, collé tel quel. Une fois écrit, il ne change plus. Chaque prestataire lit et accepte la nouvelle version dans Moi › Dossier.'
      }
      busy={busy}
      onClose={onClose}
    >
      <form className="tm-dialog__body" noValidate onSubmit={(event) => void submit(event)}>
        <div className="nv-field tm-field" data-invalid={problems.body === undefined ? undefined : 'true'}>
          <label className="nv-field__label" htmlFor={`${id}-body`}>
            Le texte
          </label>
          <textarea
            id={`${id}-body`}
            className="nv-field__control nv-glass bf-text-body"
            rows={12}
            maxLength={CONTRACT_TEXT_MAX}
            value={draft.body}
            aria-invalid={problems.body !== undefined}
            aria-describedby={`${id}-body-hint`}
            onChange={(event) => {
              change({ body: event.target.value });
            }}
          />
          <p
            id={`${id}-body-hint`}
            className={problems.body === undefined ? 'tm-hint' : 'tm-hint tm-hint--error'}
          >
            {problems.body ??
              'Son empreinte SHA-256 est calculée par le serveur : c’est elle que chaque acceptation garde.'}
          </p>
        </div>
        {mandate ? (
          <div
            className="nv-field tm-field"
            data-invalid={problems.contestDelayDays === undefined ? undefined : 'true'}
          >
            <label className="nv-field__label" htmlFor={`${id}-delay`}>
              Délai de contestation
            </label>
            <div className="bf-days">
              <input
                id={`${id}-delay`}
                className="nv-field__control nv-glass nv-num"
                inputMode="numeric"
                autoComplete="off"
                value={draft.contestDelayDays}
                aria-invalid={problems.contestDelayDays !== undefined}
                aria-describedby={`${id}-delay-hint`}
                onChange={(event) => {
                  change({ contestDelayDays: event.target.value });
                }}
              />
              <span>jours après l’émission</span>
            </div>
            <p
              id={`${id}-delay-hint`}
              className={problems.contestDelayDays === undefined ? 'tm-hint' : 'tm-hint tm-hint--error'}
            >
              {problems.contestDelayDays ??
                `De 1 à ${String(CONTEST_DELAY_MAX_DAYS)} jours, celui que le mandat écrit : passé ce délai, la facture est acceptée.`}
            </p>
          </div>
        ) : null}
        <Refusal refusal={refusal} />
        <Foot busy={busy} label="Écrire cette version" onClose={onClose} />
      </form>
    </Dialog>
  );
}

/**
 * The day the accountant validated a regime, noted once and never changed, today at the latest: the statements whose
 * invoice waited for it are tried again.
 */
export function ValidateDialog({
  regime,
  today,
  onClose,
}: {
  regime: BillingRegime;
  today: string;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshPayroll();
  const [day, setDay] = useState(today);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<InvoiceRefusal | null>(null);
  const ok = /^\d{4}-\d{2}-\d{2}$/u.test(day) && day <= today;

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setTried(true);
    if (!ok || busy) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await validateRegime(regime.id, { validatedOn: day });
    setBusy(false);
    if (outcome.kind === 'ok') {
      await refresh();
      onClose();
      return;
    }
    setRefusal(outcome);
  };

  return (
    <Dialog
      title={`Validation de « ${regime.name} »`}
      lead="Le jour où ton comptable a validé ce régime. Il se note une fois et ne change plus ; les relevés dont la facture attendait ce régime sont repris."
      busy={busy}
      onClose={onClose}
    >
      <form className="tm-dialog__body" noValidate onSubmit={(event) => void submit(event)}>
        <div className="nv-field tm-field" data-invalid={tried && !ok ? 'true' : undefined}>
          <label className="nv-field__label" htmlFor={`${id}-day`}>
            Validé le
          </label>
          <input
            id={`${id}-day`}
            type="date"
            className="nv-field__control nv-glass nv-num"
            max={today}
            value={day}
            aria-invalid={tried && !ok}
            aria-describedby={`${id}-day-hint`}
            onChange={(event) => {
              setDay(event.target.value);
            }}
          />
          <p id={`${id}-day-hint`} className={tried && !ok ? 'tm-hint tm-hint--error' : 'tm-hint'}>
            {tried && !ok
              ? `Au plus tard aujourd’hui, le ${fullDay(today)}.`
              : 'Celui de son écrit ou de son courriel.'}
          </p>
        </div>
        <Refusal refusal={refusal} />
        <Foot busy={busy} label="Noter la validation" onClose={onClose} />
      </form>
    </Dialog>
  );
}
