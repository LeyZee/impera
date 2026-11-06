import {
  JOURNAL_ACCOUNT_NAMES,
  type BillingRegime,
  type BillingSettings,
  type ContractText,
  type ContractTextKind,
} from '@impera/contracts';
import { useState, type JSX } from 'react';

import { AccountsDialog, TextDialog, ValidateDialog } from './LegalDialogs';
import { PRINTED_BY_CODE, RegimeDialog } from './RegimeDialog';
import { givenCount } from './accounts';
import { dueText, reminderDaysText } from './model';
import { Card, Fact } from './parts';
import {
  TEXT_LEADS,
  WITHHOLDING_TEXTS,
  countriesText,
  latestOf,
  regimesToShow,
  residenceWithoutTreatyText,
  showsResidenceWithoutTreaty,
  vatText,
} from './regimes';

import { ACCOUNT_LABELS } from '@/accounting/model';
import '@/contractors/contractors.css';
import { useBillingRegimes, useContractTexts } from '@/contractors/api';
import { TEXT_KINDS, TEXT_NAMES, askedText, dayText } from '@/contractors/model';
import { shortHash } from '@/payroll/model';
import { useSchedulingSettings } from '@/reports/api';
import { fullDay } from '@/scheduling/time';
import { useAgencyToday } from '@/screens/pay/data';

/** What a card opened: the accounts, a new version of a text, a new regime, or a regime's validation. */
type Opened =
  | { readonly kind: 'accounts' }
  | { readonly kind: 'text'; readonly text: ContractTextKind }
  | { readonly kind: 'regime' }
  | { readonly kind: 'validate'; readonly regime: BillingRegime };

/**
 * The second half of Réglages › Facturation (EQ-06 lot 8c): the journal's accounts, the delays, the versions of the
 * contract and of the mandate, and the regimes. Each says what it is for; the server decides, the page writes what the
 * owner gives and shows what the server answers.
 */
export function LegalCards({
  settings,
  onReminder,
}: {
  settings: BillingSettings;
  onReminder: () => void;
}): JSX.Element {
  const texts = useContractTexts();
  const regimes = useBillingRegimes();
  const today = useAgencyToday();
  const timeZone = useSchedulingSettings().data?.timeZone ?? null;
  const [opened, setOpened] = useState<Opened | null>(null);
  const close = (): void => {
    setOpened(null);
  };
  const all = texts.data?.texts ?? [];
  const mandate = latestOf(all, 'billing_mandate');
  const given = givenCount(settings.accounts);

  return (
    <>
      <Card
        index={5}
        title="Comptes du journal"
        sub="Dans l’export du journal pour le comptable"
        onChange={() => {
          setOpened({ kind: 'accounts' });
        }}
      >
        {given === JOURNAL_ACCOUNT_NAMES.length ? null : (
          <p className="tm-hint cf-amber">
            {given === 0
              ? 'Aucun compte encore : le journal ne s’exporte pas sans les huit, que ton comptable donne.'
              : `${String(given)} sur 8 : le journal ne s’exporte pas sans les huit, que ton comptable donne.`}
          </p>
        )}
        <dl className="bf-facts">
          {JOURNAL_ACCOUNT_NAMES.map((name) => (
            <Fact key={name} label={ACCOUNT_LABELS[name]}>
              <AccountValue code={settings.accounts?.[name] ?? null} />
            </Fact>
          ))}
        </dl>
      </Card>
      <Card index={6} title="Délais" sub="Ce que la paie et les rappels attendent" onChange={onReminder}>
        <dl className="bf-facts">
          <Fact label="Rappel des pièces">
            {reminderDaysText(settings.documentReminderDays)}
            <span className="bf-fact-note">L’attestation de résidence fiscale garde le 1er décembre.</span>
          </Fact>
          <Fact label="Échéance des factures">
            {dueText(settings.dueDays)}
            <span className="bf-fact-note">Se change dans Paiement.</span>
          </Fact>
          <Fact label="Contestation">
            <ContestDelay days={mandate?.contestDelayDays ?? null} />
            <span className="bf-fact-note">
              Celui de la dernière version du mandat. Chaque prestataire garde celui de la version qu’il a
              acceptée, jusqu’à ce qu’il accepte la nouvelle.
            </span>
          </Fact>
        </dl>
      </Card>
      {TEXT_KINDS.map((kind, at) => (
        <Card
          key={kind}
          index={7 + at}
          title={TEXT_NAMES[kind]}
          sub={TEXT_LEADS[kind]}
          action="Nouvelle version"
          onChange={() => {
            setOpened({ kind: 'text', text: kind });
          }}
        >
          <TextVersions
            kind={kind}
            texts={all}
            timeZone={timeZone}
            failed={texts.isError}
            loading={texts.data === undefined}
          />
        </Card>
      ))}
      <Card
        index={9}
        title="Régimes de facturation"
        sub="Ce que chaque facture imprime selon le pays du prestataire"
        action="Nouveau régime"
        onChange={() => {
          setOpened({ kind: 'regime' });
        }}
      >
        <p className="tm-hint">{PRINTED_BY_CODE}</p>
        {regimes.isError && regimes.data === undefined ? (
          <p className="tm-warn">Les régimes n’ont pas pu être lus. Recharge la page dans un instant.</p>
        ) : regimes.data === undefined ? (
          <p className="tm-hint">Lecture des régimes…</p>
        ) : regimes.data.regimes.length === 0 ? (
          <p className="tm-hint cf-amber">
            Aucun régime : sans régime validé, aucune facture ne part. Écris celui que ton comptable a rédigé.
          </p>
        ) : (
          <ul className="bf-regimes">
            {regimesToShow(regimes.data.regimes).map((regime) => (
              <RegimeItem
                key={regime.id}
                regime={regime}
                canValidate={today !== null}
                onValidate={() => {
                  setOpened({ kind: 'validate', regime });
                }}
              />
            ))}
          </ul>
        )}
      </Card>
      {opened === null ? null : opened.kind === 'accounts' ? (
        <AccountsDialog accounts={settings.accounts} onClose={close} />
      ) : opened.kind === 'text' ? (
        <TextDialog kind={opened.text} latest={latestOf(all, opened.text)} onClose={close} />
      ) : opened.kind === 'regime' ? (
        <RegimeDialog onClose={close} />
      ) : today === null ? null : (
        <ValidateDialog regime={opened.regime} today={today} onClose={close} />
      )}
    </>
  );
}

function ContestDelay({ days }: { days: number | null }): JSX.Element {
  return days === null ? (
    <span className="bf-missing">Aucun mandat encore</span>
  ) : (
    <>{`${String(days)} jours après l’émission`}</>
  );
}

function AccountValue({ code }: { code: string | null }): JSX.Element {
  return code === null ? (
    <span className="bf-missing">À donner</span>
  ) : (
    <span className="nv-num">{code}</span>
  );
}

function TextVersions({
  kind,
  texts,
  timeZone,
  failed,
  loading,
}: {
  kind: ContractTextKind;
  texts: readonly ContractText[];
  timeZone: string | null;
  failed: boolean;
  loading: boolean;
}): JSX.Element {
  if (failed && loading)
    return <p className="tm-warn">Les versions n’ont pas pu être lues. Recharge la page.</p>;
  if (loading) return <p className="tm-hint">Lecture des versions…</p>;
  const versions = texts.filter((one) => one.kind === kind);
  if (versions.length === 0)
    return (
      <p className="tm-hint cf-amber">
        {kind === 'billing_mandate'
          ? 'Aucune version : sans mandat accepté, aucune facture ne part. Colle celui que ton comptable a validé.'
          : 'Aucune version : colle celui que ton comptable a validé.'}
      </p>
    );
  return (
    <ul className="bf-versions">
      {versions.map((text, at) => (
        <li key={text.id} className="bf-version">
          <div className="bf-version__head">
            <span className="bf-version__name">Version {text.version}</span>
            {at === 0 ? <span className="rp-chip rp-chip--ok">En vigueur</span> : null}
          </div>
          <p className="bf-version__facts nv-num">
            {timeZone === null ? '' : `Écrite le ${dayText(text.createdAt, timeZone)} · `}
            {`empreinte ${shortHash(text.sha256)}`}
            {text.contestDelayDays === null ? '' : ` · contestation ${String(text.contestDelayDays)} jours`}
          </p>
          <details className="bf-version__text">
            <summary>Lire le texte</summary>
            <div className="cf-text">{text.body}</div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function RegimeItem({
  regime,
  canValidate,
  onValidate,
}: {
  regime: BillingRegime;
  canValidate: boolean;
  onValidate: () => void;
}): JSX.Element {
  const asked = askedText(regime);
  return (
    <li className="bf-regime">
      <div className="bf-version__head">
        <span className="bf-version__name">{regime.name}</span>
        {regime.validatedOn === null ? (
          <span className="rp-chip rp-chip--warn">À valider</span>
        ) : (
          <span className="rp-chip rp-chip--ok">Validé</span>
        )}
      </div>
      <dl className="bf-facts bf-facts--tight">
        <Fact label="Pays">{countriesText(regime.countries)}</Fact>
        <Fact label="TVA">{vatText(regime.vat)}</Fact>
        <Fact label="Retenue">{WITHHOLDING_TEXTS[regime.withholding]}</Fact>
        <Fact label="Pièces">
          {asked === null ? 'Aucune' : asked.charAt(0).toUpperCase() + asked.slice(1)}
        </Fact>
        <Fact label="Identifiant fiscal">{regime.taxIdRequired ? 'Exigé' : 'Pas exigé'}</Fact>
        <Fact label="Validation">
          {regime.validatedOn === null ? (
            <span className="cf-amber">Pas encore notée : aucune facture ne part sous ce régime.</span>
          ) : (
            `Par le comptable, le ${fullDay(regime.validatedOn)}`
          )}
        </Fact>
      </dl>
      {showsResidenceWithoutTreaty(regime) ? (
        <p className="tm-hint cf-amber">{residenceWithoutTreatyText}</p>
      ) : null}
      {regime.mentions.length === 0 ? null : (
        <details className="bf-version__text">
          <summary>
            {regime.mentions.length === 1
              ? 'Une mention imprimée'
              : `${String(regime.mentions.length)} mentions imprimées`}
          </summary>
          <ol className="bf-mention-list">
            {regime.mentions.map((mention, at) => (
              <li key={at}>{mention}</li>
            ))}
          </ol>
        </details>
      )}
      {regime.validatedOn === null && canValidate ? (
        <button type="button" className="nv-btn nv-btn--soft nv-btn--sm tm-self-start" onClick={onValidate}>
          Noter la validation
        </button>
      ) : null}
    </li>
  );
}
