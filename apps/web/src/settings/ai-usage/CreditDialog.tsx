import {
  AI_CREDIT_MAX_MINOR,
  type AiCreditCurrency,
  type AiCreditEntryKind,
  type AiCreditProvider,
  type AiCredits,
} from '@impera/contracts';
import { useId, useState, type JSX } from 'react';

import { addCreditEntry, removeCreditEntry, useRefreshAiUsage, type CreditOutcome } from './api';
import { CONSOLE_HINT, CREDIT_PROVIDERS, creditText } from './view';

import { parseAmount } from '@/reports/model';
import { Dialog } from '@/shell/Dialog';

/** The currency each service shows its credits in, by default: xAI sells dollars, the others bill the euro here. */
const DEFAULT_CURRENCY: Readonly<Record<AiCreditProvider, AiCreditCurrency>> = {
  xai: 'USD',
  mistral: 'EUR',
  google: 'EUR',
};

const KINDS: readonly { readonly id: AiCreditEntryKind; readonly label: string }[] = [
  { id: 'topup', label: 'Une recharge' },
  { id: 'balance', label: 'Le solde affiché' },
];

const NOT_SAVED: Readonly<Record<Exclude<CreditOutcome['kind'], 'ok'>, string>> = {
  in_future: 'Cette saisie est datée dans le futur : vérifie l’heure de ton appareil.',
  conflict: 'Cette saisie existe déjà avec un autre montant : ferme et recommence.',
  invalid: 'Le montant n’est pas valable : une recharge est d’au moins un centime.',
  session_expired: 'Ta session a expiré : reconnecte-toi, rien n’a été noté.',
  failed: 'Le serveur ne répond pas : rien n’a été noté. Réessaie dans un instant.',
};

/** A chip group: a handful of choices reads better as chips than as a list (shell/Select.tsx). */
function Chips<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: readonly { readonly id: V; readonly label: string }[];
  onChange: (value: V) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="nv-field tm-field">
      <span className="nv-field__label" id={id}>
        {label}
      </span>
      <div className="tm-choices" role="radiogroup" aria-labelledby={id}>
        {options.map((one) => (
          <button
            key={one.id}
            type="button"
            role="radio"
            className="nv-chip"
            aria-checked={value === one.id}
            onClick={() => {
              onChange(one.id);
            }}
          >
            {one.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * « Noter une recharge » (ADR 0091 § 3): a top-up, or the balance read in the service's console, written now. The
 * line's id is made when the dialog opens: a retry after a lost answer writes it once.
 */
export function CreditDialog({
  onClose,
  provider: initial = 'xai',
}: {
  onClose: () => void;
  provider?: AiCreditProvider;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshAiUsage();
  const [entryId] = useState(() => crypto.randomUUID());
  const [provider, setProvider] = useState<AiCreditProvider>(initial);
  const [kind, setKind] = useState<AiCreditEntryKind>('topup');
  const [currency, setCurrency] = useState<AiCreditCurrency>(DEFAULT_CURRENCY[initial]);
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const minor = parseAmount(amount, false, AI_CREDIT_MAX_MINOR);
  const valid = minor !== null && (kind === 'balance' || minor > 0);

  const send = async (): Promise<void> => {
    setTouched(true);
    if (minor === null || !valid || busy) return;
    setBusy(true);
    setFailure(null);
    const outcome = await addCreditEntry({ id: entryId, provider, kind, amountMinor: minor, currency });
    setBusy(false);
    if (outcome.kind === 'ok') {
      await refresh();
      onClose();
      return;
    }
    setFailure(NOT_SAVED[outcome.kind]);
  };

  return (
    <Dialog
      title="Noter une recharge"
      lead="Le CRM part de ce montant et retire le coût de chaque appel fait ensuite."
      busy={busy}
      onClose={onClose}
    >
      <form
        className="tm-dialog__body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Chips
          label="Service"
          value={provider}
          options={CREDIT_PROVIDERS.map((p) => ({ id: p.key, label: p.label }))}
          onChange={(next) => {
            setProvider(next);
            setCurrency(DEFAULT_CURRENCY[next]);
          }}
        />
        <Chips label="Ce que tu notes" value={kind} options={KINDS} onChange={setKind} />
        <div className="nv-field cia-amount" data-invalid={touched && !valid ? 'true' : undefined}>
          <label className="nv-field__label" htmlFor={`${id}-amount`}>
            {kind === 'topup' ? 'Montant rechargé' : 'Solde affiché maintenant'}
          </label>
          <div className="cia-amount__box">
            <input
              id={`${id}-amount`}
              className="nv-field__control nv-glass cia-amount__input nv-num"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amount}
              data-autofocus
              aria-invalid={touched && !valid}
              onChange={(event) => {
                setAmount(event.target.value);
                setFailure(null);
              }}
            />
            <span className="cia-amount__sign" aria-hidden="true">
              {currency === 'EUR' ? '€' : '$'}
            </span>
          </div>
          <p className={touched && !valid ? 'tm-hint tm-hint--error' : 'tm-hint'}>
            {touched && !valid
              ? 'Un montant comme 25 ou 25,50, sans signe.'
              : kind === 'topup'
                ? 'Ce que tu viens d’ajouter, tel que la console du service l’affiche.'
                : `Le solde lu dans ${CONSOLE_HINT[provider]} : il remplace le décompte à partir de maintenant.`}
          </p>
        </div>
        <Chips
          label="Devise du service"
          value={currency}
          options={[
            { id: 'USD', label: 'Dollars' },
            { id: 'EUR', label: 'Euros' },
          ]}
          onChange={setCurrency}
        />
        {failure === null ? null : (
          <p className="tm-hint tm-hint--error" role="alert">
            {failure}
          </p>
        )}
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const LINE_DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** The lines a card is counted from, latest first; one written by mistake is taken back after a confirmation. */
export function EntriesList({ card }: { card: AiCredits }): JSX.Element {
  const refresh = useRefreshAiUsage();
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const remove = async (id: string): Promise<void> => {
    setBusy(true);
    setFailed(false);
    const outcome = await removeCreditEntry(id);
    setBusy(false);
    if (outcome !== 'ok') {
      setFailed(true);
      return;
    }
    setAsking(null);
    await refresh();
  };

  return (
    <div className="cia-entries">
      <ul>
        {card.entries.map((entry) => (
          <li key={entry.id} className="cia-entry">
            <span className="cia-entry__what">
              {entry.kind === 'topup' ? 'Recharge' : 'Solde lu'}
              <span className="cia-entry__when">{LINE_DATE.format(new Date(entry.at))}</span>
            </span>
            <span className="cia-entry__amount nv-num">
              {entry.kind === 'topup' ? '+' : ''}
              {creditText(entry.amountMinor, entry.currency)}
            </span>
            {asking === entry.id ? (
              <span className="cia-entry__ask">
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm"
                  disabled={busy}
                  onClick={() => {
                    setAsking(null);
                  }}
                >
                  Garder
                </button>
                <button
                  type="button"
                  className="nv-btn nv-btn--soft nv-btn--sm cia-entry__remove"
                  disabled={busy}
                  aria-busy={busy}
                  onClick={() => {
                    void remove(entry.id);
                  }}
                >
                  Retirer
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                aria-label={`Retirer la saisie du ${LINE_DATE.format(new Date(entry.at))}`}
                onClick={() => {
                  setAsking(entry.id);
                }}
              >
                Retirer
              </button>
            )}
          </li>
        ))}
      </ul>
      {failed ? (
        <p className="tm-hint tm-hint--error" role="alert">
          Le serveur ne répond pas : la saisie est toujours là. Réessaie dans un instant.
        </p>
      ) : null}
    </div>
  );
}
