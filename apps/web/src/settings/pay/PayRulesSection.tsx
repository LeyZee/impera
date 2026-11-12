import {
  AccountPayRulesIdSchema,
  CurrencySchema,
  EARNINGS_SOURCES,
  earningsBaseOf,
  newId,
  payRulesFor,
  type AccountPayRules,
  type AccountPayRulesList,
  type Currency,
  type EarningsSource,
  type PayPeriod,
  type Platform,
  type PlanningAccount,
} from '@impera/contracts';
import { useId, useState, type JSX } from 'react';

import { MinimumPayout } from './MinimumPayout';
import { PayoutDelay } from './PayoutDelay';
import { ReportGap } from './ReportGap';

import { addPayRules, usePayRules, useRefreshPayRules, type ReportRefusal } from '@/reports/api';
import {
  parsePercent,
  percentText,
  periodLine,
  periodLineFrom,
  READ_AGAIN,
  refusalText,
  SOURCE_LABELS,
  startablePeriods,
} from '@/reports/model';
import '@/reports/reports.css';
import { accountLine } from '@/scheduling/model';
import '@/scheduling/scheduling.css';
import { Dialog } from '@/shell/Dialog';
import '@/screens/team/team.css';
import { Select } from '@/shell/Select';

type Entry = AccountPayRulesList['accounts'][number];

const CURRENCY_NAMES: Readonly<Record<Currency, string>> = { EUR: 'Euros', USD: 'Dollars' };

/** « Euros · TVA 20 % · plateforme 20 % · rapports de fin de shift »: rules in one line. */
/** On the platform's net (ADR 0050 § 8), the VAT and the commission go unused: the line leaves them out. */
const rulesLine = (rules: AccountPayRules, platform: Platform): string =>
  (earningsBaseOf(platform, rules.earningsSource) === 'platform_net'
    ? [
        CURRENCY_NAMES[rules.currency],
        SOURCE_LABELS[rules.earningsSource].toLowerCase(),
        'net de la plateforme',
      ]
    : [
        CURRENCY_NAMES[rules.currency],
        `TVA ${percentText(rules.vatBps)}`,
        `plateforme ${percentText(rules.platformFeeBps)}`,
        SOURCE_LABELS[rules.earningsSource].toLowerCase(),
      ]
  ).join(' · ');

/**
 * The periods new rules of an account may start with (EQ-03, ADR 0084): those that have not begun (the current one too
 * for its first rules) and, for its platform's net, the fortnight its platform's latest clean check covers, begun or
 * over, as the server offers it; never one the account has rules from already.
 */
function periodsFor(entry: Entry, currentPeriod: PayPeriod, source: EarningsSource): PayPeriod[] {
  const startable = startablePeriods(currentPeriod, entry.rules.length === 0);
  const checked = source === 'detected' && entry.checkedPeriod !== null ? [entry.checkedPeriod] : [];
  return [...new Set([...checked, ...startable])]
    .filter((period) => !entry.rules.some((one) => one.fromPeriod === period))
    .toSorted((a, b) => a.localeCompare(b));
}

/**
 * Réglages › Règles de paie (EQ-03, ADR 0023), owner only: for each account, the currency, the VAT, the platform's
 * commission and where pay reads the sales, dated by period. Rules are only ever added: new rules start with a period
 * that has not begun (an account's first may start with the current one), or, to read the platform's net, with the
 * fortnight its latest clean check covers (ADR 0084); a mistake is put right by the next rules. Until an account has
 * some, its reports are refused: those accounts come first.
 */
export function PayRulesSection(): JSX.Element {
  const list = usePayRules();
  const [open, setOpen] = useState<Entry | null>(null);

  if (list.isError) {
    return (
      <section className="rp-rules">
        <div className="nv-plate rp-rules__cover nv-enter">
          <p className="rp-notice__title">Le serveur ne répond pas</p>
          <p className="rp-notice__text">
            Les règles de paie n’ont pas pu être lues. Réessaie dans un instant.
          </p>
          <button
            type="button"
            className="nv-btn nv-btn--soft tm-self-start"
            onClick={() => {
              void list.refetch();
            }}
          >
            Réessayer
          </button>
        </div>
      </section>
    );
  }
  if (list.data === undefined) {
    return (
      <section className="rp-rules" aria-busy="true" aria-label="Règles de paie">
        <div className="sc-skeleton" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </section>
    );
  }

  const { currentPeriod, accounts } = list.data;
  const missing = accounts.filter((entry) => payRulesFor(entry.rules, currentPeriod) === null);
  const ordered = [...missing, ...accounts.filter((entry) => !missing.includes(entry))];

  return (
    <section className="rp-rules">
      <p className="rp-rules__lede nv-enter">
        Ce que la paie lit : le minimum de versement de toute l’équipe, le seuil d’écart des rapports, puis
        pour chaque compte la devise, la TVA, la commission de la plateforme et la source des ventes. Les
        règles d’un compte ne changent jamais : de nouvelles prennent la suite à une quinzaine qui n’a pas
        commencé, ou à la quinzaine vérifiée pour passer aux ventes relevées.
      </p>
      <MinimumPayout />
      <PayoutDelay />
      <ReportGap />
      {missing.length === 0 ? null : (
        <div className="rp-notice nv-enter" data-tone="warn" style={{ '--nv-i': 1 }}>
          <p className="rp-notice__title">
            {missing.length === 1
              ? 'Un compte sans règles de paie'
              : `${String(missing.length)} comptes sans règles de paie`}
          </p>
          <p className="rp-notice__text">
            {missing.length === 1 ? 'Ses' : 'Leurs'} rapports de fin de shift sont refusés tant qu’elles ne
            sont pas posées pour la quinzaine {periodLine(currentPeriod)}.
          </p>
        </div>
      )}
      {accounts.length === 0 ? (
        <div className="nv-plate rp-rules__cover nv-enter">
          <p className="rp-notice__title">Aucun compte plateforme</p>
          {/* No screen creates an account yet (recette du 28/10): the text asks for nothing the page cannot do. */}
          <p className="rp-notice__text">
            Les règles de paie se posent sur le compte plateforme d’une créatrice, son compte Reveal par
            exemple. Aucun n’est encore relié à Impera : chaque compte relié apparaîtra ici.
          </p>
        </div>
      ) : (
        <ul className="rp-accounts">
          {ordered.map((entry, index) => (
            <AccountRules
              key={entry.account.id}
              entry={entry}
              index={index}
              currentPeriod={currentPeriod}
              onAdd={() => {
                setOpen(entry);
              }}
            />
          ))}
        </ul>
      )}
      {open === null ? null : (
        <RulesPanel
          entry={open}
          currentPeriod={currentPeriod}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </section>
  );
}

function AccountRules({
  entry,
  index,
  currentPeriod,
  onAdd,
}: {
  entry: Entry;
  index: number;
  currentPeriod: PayPeriod;
  onAdd: () => void;
}): JSX.Element {
  const inForce = payRulesFor(entry.rules, currentPeriod);
  const coming = entry.rules
    .filter((one) => one.fromPeriod > currentPeriod)
    .toSorted((a, b) => a.fromPeriod.localeCompare(b.fromPeriod));
  const past = entry.rules.filter((one) => one.fromPeriod <= currentPeriod && one.id !== inForce?.id);
  return (
    <li className="nv-plate rp-account nv-enter" style={{ '--nv-i': Math.min(index + 1, 8) }}>
      <div className="rp-account__head">
        <div className="rp-account__who">
          <p className="rp-account__name">{entry.account.creatorName}</p>
          <p className="rp-account__handle">{accountLine(entry.account)}</p>
        </div>
        <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={onAdd}>
          {inForce === null && coming.length === 0 ? 'Poser les règles' : 'Nouvelles règles'}
        </button>
      </div>
      {inForce === null ? (
        <p className="rp-account__none">
          {coming.length === 0 ? 'Aucune règle pour l’instant.' : 'Aucune règle pour la quinzaine en cours.'}
        </p>
      ) : (
        <div className="rp-account__now">
          <span className="rp-chip rp-chip--ok">En vigueur</span>
          <p className="rp-account__rules nv-num">{rulesLine(inForce, entry.account.platform)}</p>
          <p className="rp-account__since">
            depuis la quinzaine {periodLineFrom(inForce.fromPeriod, currentPeriod)}
          </p>
        </div>
      )}
      {entry.checkedPeriod === null ? null : (
        <div className="rp-account__next rp-account__checked">
          <span className="rp-chip rp-chip--ok">Ventes vérifiées</span>
          <p className="rp-account__since">
            peut passer aux ventes relevées dès la quinzaine{' '}
            {periodLineFrom(entry.checkedPeriod, currentPeriod)}
          </p>
        </div>
      )}
      {coming.map((rules) => (
        <div key={rules.id} className="rp-account__next">
          <span className="rp-chip">À venir</span>
          <p className="rp-account__rules nv-num">{rulesLine(rules, entry.account.platform)}</p>
          <p className="rp-account__since">
            à partir de la quinzaine {periodLineFrom(rules.fromPeriod, currentPeriod)}
          </p>
        </div>
      ))}
      {past.length === 0 ? null : (
        <details className="nv-disclosure rp-account__past">
          <summary>
            <span className="nv-disclosure__title">Avant</span>
            <span className="nv-disclosure__sum">
              {past.length} règle{past.length > 1 ? 's' : ''} précédente{past.length > 1 ? 's' : ''}
            </span>
          </summary>
          <ul className="nv-disclosure__body rp-lines">
            {past.map((rules) => (
              <li key={rules.id} className="rp-account__old">
                <span className="nv-num">{rulesLine(rules, entry.account.platform)}</span>
                <span className="rp-account__since">
                  dès la quinzaine {periodLineFrom(rules.fromPeriod, currentPeriod)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/**
 * New rules for one account, in two steps: the values, then a recap to confirm, since rules never change once
 * posted. The id is made when the panel opens, so a retry records one rule.
 */
function RulesPanel({
  entry,
  currentPeriod,
  onClose,
}: {
  entry: Entry;
  currentPeriod: PayPeriod;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshPayRules();
  const first = entry.rules.length === 0;
  const base = entry.rules[0] ?? null;
  // Only a platform that gives a net can be paid on its sales read (ADR 0050 § 8).
  const hasNet = earningsBaseOf(entry.account.platform, 'detected') === 'platform_net';
  const [source, setSource] = useState<EarningsSource>('declared');
  const periods = periodsFor(entry, currentPeriod, source);
  const [rulesId] = useState(() => newId(AccountPayRulesIdSchema));
  // Until the owner picks one, the earliest period the source allows: with « Ventes relevées », the checked
  // fortnight; back to the reports, the first period that has not begun.
  const [chosenPeriod, setFromPeriod] = useState<PayPeriod | null>(null);
  const fromPeriod =
    chosenPeriod !== null && periods.includes(chosenPeriod) ? chosenPeriod : (periods[0] ?? null);
  const backdated = source === 'detected' && fromPeriod !== null && fromPeriod <= currentPeriod;
  const [currency, setCurrency] = useState<Currency>(base?.currency ?? 'EUR');
  const [vat, setVat] = useState(base === null ? '' : String(base.vatBps / 100).replace('.', ','));
  const [fee, setFee] = useState(base === null ? '' : String(base.platformFeeBps / 100).replace('.', ','));
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<ReportRefusal | null>(null);

  // On the platform's net the VAT and the commission go unused: not asked, the rules keep the account's last ones.
  const netOnly = hasNet && source === 'detected';
  const vatBps = netOnly ? (base?.vatBps ?? 0) : parsePercent(vat);
  const feeBps = netOnly ? (base?.platformFeeBps ?? 0) : parsePercent(fee);
  const ready = fromPeriod !== null && vatBps !== null && feeBps !== null;

  const send = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await addPayRules({
      id: rulesId,
      platformAccountId: entry.account.id,
      fromPeriod,
      currency,
      vatBps,
      platformFeeBps: feeBps,
      earningsSource: source,
    });
    setBusy(false);
    if (outcome.kind === 'ok') {
      await refresh();
      onClose();
      return;
    }
    if (outcome.kind === 'refused' && READ_AGAIN.has(outcome.code)) await refresh();
    setRefusal(outcome);
    setStep('edit');
  };

  return (
    <Dialog
      title={first ? 'Poser les règles de paie' : 'Nouvelles règles de paie'}
      lead={<AccountLead account={entry.account} />}
      busy={busy}
      onClose={onClose}
    >
      {step === 'confirm' && ready ? (
        <div className="tm-dialog__body">
          <div className="rp-recap nv-enter">
            <p className="nv-eyebrow">À partir de la quinzaine {periodLineFrom(fromPeriod, currentPeriod)}</p>
            <dl className="rp-recap__list">
              <div>
                <dt>Devise</dt>
                <dd>{CURRENCY_NAMES[currency]}</dd>
              </div>
              {netOnly ? (
                <div>
                  <dt>TVA et commission</dt>
                  <dd>Sans effet</dd>
                </div>
              ) : (
                <>
                  <div>
                    <dt>TVA</dt>
                    <dd className="nv-num">{percentText(vatBps)}</dd>
                  </div>
                  <div>
                    <dt>Commission de la plateforme</dt>
                    <dd className="nv-num">{percentText(feeBps)}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>Source des ventes</dt>
                <dd>{SOURCE_LABELS[source]}</dd>
              </div>
            </dl>
          </div>
          {backdated ? (
            <p className="tm-warn nv-enter">
              {fromPeriod < currentPeriod
                ? 'Cette quinzaine est déjà finie'
                : 'Cette quinzaine a déjà commencé'}
              {'\u00a0'}: ses relevés en brouillon seront recalculés sur les ventes relevées, et les ventes
              déclarées dans ses rapports ne compteront plus.
            </p>
          ) : null}
          <p className="tm-hint">
            Ces règles ne changeront plus. Une erreur se corrige par de nouvelles règles à une quinzaine
            suivante.
          </p>
          <div className="tm-dialog__foot">
            <button
              type="button"
              className="nv-btn nv-btn--plain"
              disabled={busy}
              onClick={() => {
                setStep('edit');
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
              {busy ? 'Enregistrement…' : 'Poser ces règles'}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="tm-dialog__body"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (ready) setStep('confirm');
          }}
        >
          <div className="nv-field tm-field">
            <span className="nv-field__label" id={`${id}-source`}>
              Source des ventes
            </span>
            <div className="tm-choices" role="radiogroup" aria-labelledby={`${id}-source`}>
              {EARNINGS_SOURCES.map((one) => (
                <button
                  key={one}
                  type="button"
                  role="radio"
                  className="nv-chip"
                  aria-checked={source === one}
                  disabled={one === 'detected' && !hasNet}
                  onClick={() => {
                    setSource(one);
                    setRefusal(null);
                  }}
                >
                  {SOURCE_LABELS[one]}
                </button>
              ))}
            </div>
            <p className="tm-hint">
              {!hasNet
                ? 'Cette plateforme ne donne pas de net : la paie de ce compte lit les rapports validés.'
                : source === 'declared'
                  ? 'La paie lit les rapports de fin de shift validés.'
                  : 'La paie lit les ventes relevées chez la plateforme, à son net : ni TVA ni commission à retirer. Chacune va au chatteur relié qui était en poste, qui ne déclare plus ses ventes.'}
            </p>
          </div>

          <div className="nv-field tm-field">
            <label className="nv-field__label" htmlFor={`${id}-from`}>
              À partir de la quinzaine
            </label>
            {periods.length === 0 ? (
              <p className="tm-hint tm-hint--error">
                Les prochaines quinzaines ont déjà leurs règles : rien à poser avant elles.
              </p>
            ) : (
              <Select
                id={`${id}-from`}
                value={fromPeriod ?? ''}
                autofocus
                options={periods.map((period) => ({
                  value: period,
                  label: periodLineFrom(period, currentPeriod),
                  ...(source === 'detected' && period === entry.checkedPeriod
                    ? { hint: 'vérifiée' }
                    : period === currentPeriod
                      ? { hint: 'en cours' }
                      : {}),
                }))}
                onChange={(value) => {
                  setFromPeriod(periods.find((period) => period === value) ?? null);
                }}
              />
            )}
            <p className="tm-hint">
              {source === 'detected' && entry.checkedPeriod !== null
                ? 'Les ventes relevées peuvent partir de la quinzaine vérifiée, tant qu’aucune quinzaine n’est clôturée depuis.'
                : source === 'detected'
                  ? 'Pour partir d’une quinzaine déjà commencée, lance d’abord la vérification de fiabilité de cette quinzaine dans Réglages › Ventes.'
                  : first
                    ? 'Les premières règles d’un compte peuvent partir de la quinzaine en cours.'
                    : 'De nouvelles règles partent d’une quinzaine qui n’a pas commencé.'}
            </p>
          </div>

          <div className="nv-field tm-field">
            <span className="nv-field__label" id={`${id}-currency`}>
              Devise des ventes
            </span>
            <div className="tm-choices" role="radiogroup" aria-labelledby={`${id}-currency`}>
              {CurrencySchema.options.map((one) => (
                <button
                  key={one}
                  type="button"
                  role="radio"
                  className="nv-chip"
                  aria-checked={currency === one}
                  onClick={() => {
                    setCurrency(one);
                  }}
                >
                  {CURRENCY_NAMES[one]}
                </button>
              ))}
            </div>
          </div>

          {netOnly ? null : (
            <div className="tm-pair">
              <Percent
                id={`${id}-vat`}
                label="TVA"
                hint="Retirée du brut, après la conversion en euros."
                value={vat}
                invalid={touched && vatBps === null}
                onChange={setVat}
              />
              <Percent
                id={`${id}-fee`}
                label="Commission de la plateforme"
                hint="Ce que la plateforme garde sur le hors-taxe."
                value={fee}
                invalid={touched && feeBps === null}
                onChange={setFee}
              />
            </div>
          )}

          {refusal === null ? null : (
            <p className="tm-warn sc-refusal nv-swap" role="alert">
              {refusal.kind === 'failed'
                ? 'Le serveur ne répond pas : rien n’a été enregistré. Réessaie dans un instant.'
                : refusalText(refusal)}
            </p>
          )}

          <div className="tm-dialog__foot">
            <button type="button" className="nv-btn nv-btn--plain" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="nv-btn nv-btn--neon" disabled={periods.length === 0}>
              Vérifier
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function AccountLead({ account }: { account: PlanningAccount }): JSX.Element {
  return (
    <>
      <span className="rp-lead__who">{account.creatorName}</span>
      <span className="rp-lead__sep"> · </span>
      <span className="rp-lead__account">{accountLine(account)}</span>
    </>
  );
}

function Percent({
  id,
  label,
  hint,
  value,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="nv-field tm-field" data-invalid={invalid ? 'true' : undefined}>
      <label className="nv-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="tm-percent">
        <input
          id={id}
          className="nv-field__control nv-glass nv-num"
          inputMode="decimal"
          autoComplete="off"
          placeholder="20"
          value={value}
          aria-invalid={invalid}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        %
      </div>
      <p className={invalid ? 'tm-hint tm-hint--error' : 'tm-hint'}>
        {invalid ? 'Un taux entre 0 et 100, comme 20 ou 5,5.' : hint}
      </p>
    </div>
  );
}
