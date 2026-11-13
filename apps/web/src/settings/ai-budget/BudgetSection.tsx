import type { AiBudget } from '@impera/contracts';
import { useId, useState, type JSX } from 'react';

import { PasswordPrompt } from '../services/PasswordPrompt';

import { saveAiBudget, useAiBudget, useSetAiBudget, type SaveOutcome } from './api';
import { amountOf, boundsText, consequenceOf, eurOf, todayOf, typedOf, type Field } from './view';

import { Dialog } from '@/shell/Dialog';
import './ai-budget.css';

const NOT_SAVED: Readonly<Record<Exclude<SaveOutcome['kind'], 'ok' | 'reauth' | 'refused'>, string>> = {
  session_expired: 'Ta session a expiré : reconnecte-toi, rien n’a changé.',
  failed: 'Le serveur ne répond pas : rien n’a changé. Réessaie dans un instant.',
};

/**
 * Réglages › Modèles IA › Budget IA (choix de Charles 12/11): what the AI may spend a day, for every creator, and the
 * trend watch's share of it. The owner's alone, like the page.
 */
export function BudgetSection(): JSX.Element | null {
  const query = useAiBudget();
  const [editing, setEditing] = useState(false);
  const budget = query.data;
  if (budget === undefined) {
    return query.isError ? (
      <div className="nv-plate aib-card">
        <p className="sv-lead">Budget IA</p>
        <p className="sv-muted">Le budget n’a pas pu être lu. Réessaie dans un instant.</p>
      </div>
    ) : null;
  }
  const reached = budget.state === 'reached';
  return (
    <div className="nv-plate aib-card" aria-live="polite">
      <div className="aib-card__head">
        <div className="aib-card__text">
          <p className="sv-lead">Budget IA</p>
          <p className="sv-muted">Pour toutes les créatrices. Au-delà, l’agent s’arrête jusqu’à minuit.</p>
        </div>
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm"
          onClick={() => {
            setEditing(true);
          }}
        >
          Modifier
        </button>
      </div>
      <dl className="aib-figures">
        <div className="aib-figure">
          <dt>Plafond du jour</dt>
          <dd className="nv-num">{eurOf(budget.dailyCapMinor)}</dd>
          <span className="aib-figure__note">
            {budget.isCustom.dailyCap
              ? `par défaut ${eurOf(budget.defaults.dailyCapMinor)}`
              : 'valeur par défaut'}
          </span>
        </div>
        <div className="aib-figure">
          <dt>Plafond de veille</dt>
          <dd className="nv-num">{eurOf(budget.trendWatchCapMinor)}</dd>
          <span className="aib-figure__note">
            {budget.isCustom.trendWatchCap
              ? `par défaut ${eurOf(budget.defaults.trendWatchCapMinor)}`
              : 'valeur par défaut'}
          </span>
        </div>
      </dl>
      <p className="aib-today" data-tone={reached ? 'bad' : budget.state === 'alert' ? 'warn' : 'ok'}>
        {todayOf(budget)}
      </p>
      {editing ? (
        <BudgetDialog
          budget={budget}
          onClose={() => {
            setEditing(false);
          }}
        />
      ) : null}
    </div>
  );
}

function AmountField({
  field,
  label,
  value,
  hint,
  invalid,
  autoFocus,
  onChange,
}: {
  field: Field;
  label: string;
  value: string;
  hint: string;
  invalid: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="nv-field aib-amount" data-invalid={invalid ? 'true' : undefined}>
      <label className="nv-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="aib-amount__box">
        <input
          id={id}
          className="nv-field__control nv-glass aib-amount__input nv-num"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          aria-invalid={invalid}
          aria-describedby={`${id}-hint`}
          data-autofocus={autoFocus === true ? '' : undefined}
          data-field={field}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <span className="aib-amount__sign" aria-hidden="true">
          €
        </span>
      </div>
      <p id={`${id}-hint`} className={invalid ? 'tm-hint tm-hint--error' : 'tm-hint'}>
        {hint}
      </p>
    </div>
  );
}

/** « Budget IA »: both values, a way back to the defaults; the password and a code when the sign-in is old. */
function BudgetDialog({ budget, onClose }: { budget: AiBudget; onClose: () => void }): JSX.Element {
  const show = useSetAiBudget();
  const [daily, setDaily] = useState(() => typedOf(budget.dailyCapMinor));
  const [trendWatch, setTrendWatch] = useState(() => typedOf(budget.trendWatchCapMinor));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dailyMinor = amountOf(daily, 'daily');
  const trendWatchMinor = amountOf(trendWatch, 'trendWatch');
  const consequence = consequenceOf(budget, dailyMinor, trendWatchMinor);
  const valid = dailyMinor !== null && trendWatchMinor !== null && consequence?.tone !== 'error';

  const send = async (): Promise<void> => {
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    setFailure(null);
    // The default is stored as « none »: a later change of the code's default reaches it.
    const outcome = await saveAiBudget({
      dailyCapMinor: dailyMinor === budget.defaults.dailyCapMinor ? null : dailyMinor,
      trendWatchCapMinor: trendWatchMinor === budget.defaults.trendWatchCapMinor ? null : trendWatchMinor,
    });
    setBusy(false);
    if (outcome.kind === 'ok') {
      show(outcome.value);
      onClose();
      return;
    }
    if (outcome.kind === 'reauth') {
      setReauth(true);
      return;
    }
    setFailure(outcome.kind === 'refused' ? outcome.message : NOT_SAVED[outcome.kind]);
  };

  const isDefault =
    dailyMinor === budget.defaults.dailyCapMinor && trendWatchMinor === budget.defaults.trendWatchCapMinor;

  return (
    <Dialog
      title="Budget IA"
      lead="Ce que l’IA peut dépenser par jour, de minuit à minuit, pour toutes les créatrices. Au-delà, les conversations passent aux chatteurs."
      busy={busy}
      onClose={onClose}
    >
      {reauth ? (
        <div className="tm-dialog__body">
          <PasswordPrompt
            lead="Pour changer le budget IA, confirme ton mot de passe et ton code."
            onConfirmed={() => {
              setReauth(false);
              void send();
            }}
            onCancel={() => {
              setReauth(false);
            }}
          />
        </div>
      ) : (
        <form
          className="tm-dialog__body"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <AmountField
            field="daily"
            label="Plafond du jour"
            value={daily}
            autoFocus
            invalid={touched && dailyMinor === null}
            hint={`${boundsText('daily')}. Par défaut ${eurOf(budget.defaults.dailyCapMinor)} ; l’alerte part à 80\u00a0%.`}
            onChange={(next) => {
              setDaily(next);
              setFailure(null);
            }}
          />
          <AmountField
            field="trendWatch"
            label="Plafond de veille"
            value={trendWatch}
            invalid={touched && trendWatchMinor === null}
            hint={`${boundsText('trendWatch')}, compté dans le plafond du jour. Par défaut ${eurOf(budget.defaults.trendWatchCapMinor)}.`}
            onChange={(next) => {
              setTrendWatch(next);
              setFailure(null);
            }}
          />
          {consequence === null ? null : (
            <p className="aib-consequence" data-tone={consequence.tone} role="status">
              {consequence.text}
            </p>
          )}
          {failure === null ? null : (
            <p className="tm-hint tm-hint--error" role="alert">
              {failure}
            </p>
          )}
          <div className="tm-dialog__foot aib-foot">
            <button
              type="button"
              className="nv-btn nv-btn--plain aib-foot__reset"
              disabled={busy || isDefault}
              onClick={() => {
                setDaily(typedOf(budget.defaults.dailyCapMinor));
                setTrendWatch(typedOf(budget.defaults.trendWatchCapMinor));
                setFailure(null);
              }}
            >
              Valeurs par défaut
            </button>
            <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
