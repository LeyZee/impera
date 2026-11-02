import type { AccountingJournal, AccountingPeriodQuery, Das2Export, Me } from '@nirvana/contracts';
import { Link } from '@tanstack/react-router';
import { useId, useState, type SyntheticEvent, type JSX, type ReactNode } from 'react';

import { PayNav } from './PayNav';
import { useAgencyToday } from './data';
import { Loading } from './parts';

import {
  bytesOf,
  readArchive,
  readDas2,
  readJournal,
  saveFile,
  type ArchiveFile,
  type ExportOutcome,
  type ExportRefusal,
} from '@/accounting/api';
import '@/accounting/accounting.css';
import {
  DAS2_WARNING_LABELS,
  DAS2_WARNING_TEXTS,
  das2Years,
  fiscalYears,
  missingAccountsText,
  periodQuery,
  warningsOf,
  type DayRange,
} from '@/accounting/model';
import '@/payroll/pay.css';
import { amountText, periodTitle } from '@/reports/model';
import '@/reports/reports.css';
import { fullDay } from '@/scheduling/time';
import { useMembers } from '@/screens/team/api';
import { useBillingSettings } from '@/settings/billing/api';
import { weightText } from '@/settings/billing/model';
import '@/screens/team/team.css';
import { Page, PageHeader, Panel } from '@/shell/layout';

/**
 * Paie › Exports (EQ-06 lot 8c), the owner's alone: the three files of the accountant, each asked for, then saved as
 * the server made it. The journal and the DAS2 recap come in JSON with their file in base64, kept as bytes; the archive
 * comes as its ZIP, which the screen never opens. What a file leaves aside is said in amber beside it.
 */
export function ExportsPage({ user }: { user: Me }): JSX.Element {
  const today = useAgencyToday();
  const billing = useBillingSettings();
  const members = useMembers();
  const nameOf = (memberId: string): string =>
    members.data?.find((one) => one.id === memberId)?.displayName ?? 'Un membre';
  // The fiscal year the settings name, December without them; the page waits for the settings only a moment.
  const endMonth = billing.data?.settings?.fiscalYearEndMonth;
  const ready = today !== null && (billing.data !== undefined || billing.isError);
  const years = ready ? fiscalYears(today, endMonth) : null;

  return (
    <Page>
      <PageHeader
        eyebrow="Paie"
        title="Exports"
        lead="Les trois fichiers du comptable, tels que le serveur les fait : le journal des prestataires, le récapitulatif DAS2 et l’archive des PDF."
        actions={<PayNav user={user} />}
      />
      <div className="py-board">
        {years === null || today === null ? (
          <Panel className="nv-enter">
            <Loading rows={3} />
          </Panel>
        ) : (
          <>
            <JournalPanel years={years} nameOf={nameOf} />
            <Das2Panel today={today} nameOf={nameOf} />
            <ArchivePanel years={years} />
          </>
        )}
      </div>
    </Page>
  );
}

type Years = ReturnType<typeof fiscalYears>;

/** An export asked for: nothing yet, on its way, its file, or its refusal. */
type Asked<T> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly outcome: ExportOutcome<T> };

const IDLE = { kind: 'idle' } as const;

function JournalPanel({
  years,
  nameOf,
}: {
  years: Years;
  nameOf: (memberId: string) => string;
}): JSX.Element {
  const [asked, setAsked] = useState<Asked<AccountingJournal>>(IDLE);
  return (
    <Panel className="nv-enter" eyebrow="Journal" title="Journal des prestataires">
      <div className="ex-body">
        <p className="py-quiet ex-lead">
          Les écritures des factures, factures rectificatives et avoirs émis sur la période, et celles des
          virements, aux colonnes du FEC : un fichier d’import pour le comptable, pas le FEC de l’agence.
        </p>
        <RangeForm
          name="journal"
          years={years}
          action="Préparer le journal"
          busy={asked.kind === 'busy'}
          onChange={() => {
            setAsked(IDLE);
          }}
          onAsk={async (range) => {
            setAsked({ kind: 'busy' });
            setAsked({ kind: 'done', outcome: await readJournal(range) });
          }}
        />
        {asked.kind === 'done' ? (
          asked.outcome.kind === 'ok' ? (
            <JournalReady journal={asked.outcome.value} nameOf={nameOf} />
          ) : (
            <RefusalLine refusal={asked.outcome} what="journal" />
          )
        ) : null}
      </div>
    </Panel>
  );
}

function JournalReady({
  journal,
  nameOf,
}: {
  journal: AccountingJournal;
  nameOf: (memberId: string) => string;
}): JSX.Element {
  const count = journal.entryCount;
  return (
    <div className="ex-ready nv-swap">
      <FileLine
        name={journal.fileName}
        detail={
          count === 0
            ? 'Aucune écriture sur la période'
            : `${String(count)} écriture${count === 1 ? '' : 's'}`
        }
        label="Télécharger le journal"
        onSave={() => {
          saveFile(bytesOf(journal.content, journal.mediaType), journal.fileName);
        }}
      />
      {journal.unbalanced.length === 0 ? null : (
        <Notice
          title={
            journal.unbalanced.length === 1
              ? 'Un groupe reste sans lettre'
              : `${String(journal.unbalanced.length)} groupes restent sans lettre`
          }
          text="Leurs lignes au compte du prestataire ne font pas zéro : un prestataire qui facture la TVA est payé hors taxes, comme le dit son relevé. Le comptable les lettre lui-même."
        >
          {journal.unbalanced.map((group) => (
            <li key={`${group.prefix}-${group.period}`}>
              <span className="nv-num">{group.prefix}</span>, relevé du {periodTitle(group.period)}
            </li>
          ))}
        </Notice>
      )}
      {journal.transfersLeftOut.length === 0 ? null : (
        <Notice
          title={
            journal.transfersLeftOut.length === 1
              ? 'Un virement reste hors du fichier'
              : `${String(journal.transfersLeftOut.length)} virements restent hors du fichier`
          }
          text="Leur membre n’a encore aucun document, donc aucun compte de prestataire : un versement enregistré avant que le paiement attende sa facture. Le comptable les passe à la main."
        >
          {journal.transfersLeftOut.map((transfer) => (
            <li key={`${transfer.memberId}-${transfer.period}`}>
              {nameOf(transfer.memberId)}, quinzaine du {periodTitle(transfer.period)}
            </li>
          ))}
        </Notice>
      )}
    </div>
  );
}

function Das2Panel({ today, nameOf }: { today: string; nameOf: (memberId: string) => string }): JSX.Element {
  const id = useId();
  const years = das2Years(today);
  // The recap of a year is declared the next spring: the year just ended comes first.
  const [year, setYear] = useState(years[1] ?? years[0] ?? Number(today.slice(0, 4)));
  const [asked, setAsked] = useState<Asked<Das2Export>>(IDLE);
  const busy = asked.kind === 'busy';
  const onSubmit = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (busy) return;
    setAsked({ kind: 'busy' });
    void readDas2(year).then((outcome) => {
      setAsked({ kind: 'done', outcome });
    });
  };
  return (
    <Panel className="nv-enter" eyebrow="DAS2" title="Récapitulatif DAS2">
      <div className="ex-body">
        <p className="py-quiet ex-lead">
          Chaque prestataire payé de plus de 2 400 € par les virements d’une année civile, sous l’identité que
          sa facture a figée. Un récapitulatif à vérifier : c’est le comptable qui dépose la déclaration.
        </p>
        <form className="ex-form" onSubmit={onSubmit} noValidate>
          <div className="nv-field tm-field">
            <label className="nv-field__label" htmlFor={`${id}-year`}>
              Année des virements
            </label>
            <select
              id={`${id}-year`}
              className="nv-field__control nv-glass tm-select nv-num"
              value={year}
              onChange={(event) => {
                setYear(Number(event.target.value));
                setAsked(IDLE);
              }}
            >
              {years.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="nv-btn nv-btn--neon ex-ask" disabled={busy} aria-busy={busy}>
            {busy ? 'Préparation…' : 'Préparer le récapitulatif'}
          </button>
        </form>
        {asked.kind === 'done' ? (
          asked.outcome.kind === 'ok' ? (
            <Das2Ready recap={asked.outcome.value} nameOf={nameOf} />
          ) : (
            <RefusalLine refusal={asked.outcome} what="das2" />
          )
        ) : null}
      </div>
    </Panel>
  );
}

function Das2Ready({
  recap,
  nameOf,
}: {
  recap: Das2Export;
  nameOf: (memberId: string) => string;
}): JSX.Element {
  const { beneficiaries } = recap;
  const warnings = warningsOf(beneficiaries);
  return (
    <div className="ex-ready nv-swap">
      <FileLine
        name={recap.fileName}
        detail={
          beneficiaries.length === 0
            ? 'Aucun bénéficiaire'
            : `${String(beneficiaries.length)} bénéficiaire${beneficiaries.length === 1 ? '' : 's'}`
        }
        label="Télécharger le CSV"
        onSave={() => {
          saveFile(bytesOf(recap.content, recap.mediaType), recap.fileName);
        }}
      />
      {recap.notes.includes('amounts_as_sent') ? (
        <p className="py-quiet">
          Montants partis : ce que chaque virement a envoyé, à son jour, jamais ce qui a été facturé.
        </p>
      ) : null}
      {beneficiaries.length === 0 ? (
        <p className="py-quiet">
          Personne n’a reçu plus de 2 400 € en {recap.year} : aucune ligne à déclarer.
        </p>
      ) : (
        <div className="ex-table-wrap">
          <table className="ex-table">
            <caption className="sr-only">Bénéficiaires {recap.year}</caption>
            <thead>
              <tr>
                <th scope="col">Bénéficiaire</th>
                <th scope="col" className="ex-num">
                  Versé
                </th>
                <th scope="col" className="ex-num">
                  Dont sous convention
                </th>
              </tr>
            </thead>
            <tbody>
              {beneficiaries.map((one) => (
                <tr key={one.memberId}>
                  <th scope="row">
                    <span className="ex-who">{one.identity?.legalName ?? nameOf(one.memberId)}</span>
                    <span className="ex-sub">
                      {one.identity === null
                        ? 'Commissions, sans identité'
                        : `Commissions${one.identity.taxId === null ? '' : `, ${one.identity.taxId}`}`}
                    </span>
                    {one.warnings.length === 0 ? null : (
                      <span className="ex-chips">
                        {one.warnings.map((warning) => (
                          <span key={warning} className="rp-chip rp-chip--warn">
                            {DAS2_WARNING_LABELS[warning]}
                          </span>
                        ))}
                      </span>
                    )}
                  </th>
                  <td className="ex-num nv-num">{amountText(one.paidMinor, 'EUR')}</td>
                  <td className="ex-num nv-num">{amountText(one.treatyExemptMinor, 'EUR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {warnings.length === 0 ? null : (
        <Notice title="À vérifier avec le comptable" text={null}>
          {warnings.map((warning) => (
            <li key={warning}>
              <strong>{DAS2_WARNING_LABELS[warning]}</strong> : {DAS2_WARNING_TEXTS[warning]}
            </li>
          ))}
        </Notice>
      )}
    </div>
  );
}

function ArchivePanel({ years }: { years: Years }): JSX.Element {
  const [asked, setAsked] = useState<Asked<ArchiveFile>>(IDLE);
  return (
    <Panel className="nv-enter" eyebrow="Archive" title="Archive des PDF">
      <div className="ex-body">
        <p className="py-quiet ex-lead">
          Le PDF de chaque facture, facture rectificative et avoir émis sur la période, sous son numéro.
          Dedans, manifeste.csv liste chaque document avec son empreinte, ou la raison de son absence. Une
          ligne « hébergeurs injoignables » n’abîme rien : relance l’export.
        </p>
        <RangeForm
          name="archive"
          years={years}
          action="Préparer l’archive"
          busy={asked.kind === 'busy'}
          onChange={() => {
            setAsked(IDLE);
          }}
          onAsk={async (range) => {
            setAsked({ kind: 'busy' });
            setAsked({ kind: 'done', outcome: await readArchive(range) });
          }}
        />
        {asked.kind === 'done' ? (
          asked.outcome.kind === 'ok' ? (
            <ArchiveReady archive={asked.outcome.value} />
          ) : (
            <RefusalLine refusal={asked.outcome} what="archive" />
          )
        ) : null}
      </div>
    </Panel>
  );
}

function ArchiveReady({ archive }: { archive: ArchiveFile }): JSX.Element {
  return (
    <div className="ex-ready nv-swap">
      <FileLine
        name={archive.fileName}
        detail={weightText(archive.bytes.size)}
        label="Télécharger l’archive"
        onSave={() => {
          saveFile(archive.bytes, archive.fileName);
        }}
      />
    </div>
  );
}

/**
 * Two days, both included, two years at most: the fiscal year in progress by default, the one before it a click away,
 * any other typed (a first fiscal year runs up to 24 months). The contract's reason is said before anything is sent.
 */
function RangeForm({
  name,
  years,
  action,
  busy,
  onChange,
  onAsk,
}: {
  name: string;
  years: Years;
  action: string;
  busy: boolean;
  onChange: () => void;
  onAsk: (range: AccountingPeriodQuery) => Promise<void>;
}): JSX.Element {
  const id = useId();
  const [range, setRange] = useState<DayRange>(years.current);
  const [tried, setTried] = useState(false);
  const checked = periodQuery(range);
  const wrong = tried && !checked.ok;
  const choose = (next: DayRange): void => {
    setRange(next);
    onChange();
  };
  const onSubmit = (event: SyntheticEvent): void => {
    event.preventDefault();
    setTried(true);
    if (!checked.ok || busy) return;
    void onAsk(checked.query);
  };
  const same = (one: DayRange): boolean => one.from === range.from && one.to === range.to;
  return (
    <form className="ex-form" onSubmit={onSubmit} noValidate aria-label={`Période : ${name}`}>
      <div className="ex-presets" role="group" aria-label="Exercices">
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm"
          aria-pressed={same(years.current)}
          onClick={() => {
            choose(years.current);
          }}
        >
          Exercice en cours
        </button>
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm"
          aria-pressed={same(years.previous)}
          onClick={() => {
            choose(years.previous);
          }}
        >
          Exercice précédent
        </button>
      </div>
      <div className="ex-days">
        <div className="nv-field tm-field" data-invalid={wrong ? 'true' : undefined}>
          <label className="nv-field__label" htmlFor={`${id}-from`}>
            Du
          </label>
          <input
            id={`${id}-from`}
            type="date"
            className="nv-field__control nv-glass nv-num"
            value={range.from}
            aria-invalid={wrong}
            aria-describedby={`${id}-hint`}
            onChange={(event) => {
              choose({ ...range, from: event.target.value });
            }}
          />
        </div>
        <div className="nv-field tm-field" data-invalid={wrong ? 'true' : undefined}>
          <label className="nv-field__label" htmlFor={`${id}-to`}>
            Au
          </label>
          <input
            id={`${id}-to`}
            type="date"
            className="nv-field__control nv-glass nv-num"
            value={range.to}
            aria-invalid={wrong}
            aria-describedby={`${id}-hint`}
            onChange={(event) => {
              choose({ ...range, to: event.target.value });
            }}
          />
        </div>
        <button type="submit" className="nv-btn nv-btn--neon ex-ask" disabled={busy} aria-busy={busy}>
          {busy ? 'Préparation…' : action}
        </button>
      </div>
      <p id={`${id}-hint`} className={wrong ? 'tm-hint tm-hint--error' : 'tm-hint'}>
        {checked.ok
          ? `Du ${fullDay(checked.query.from)} au ${fullDay(checked.query.to)}, les deux compris.`
          : tried
            ? checked.reason
            : 'Deux jours compris, deux ans au plus.'}
      </p>
    </form>
  );
}

/** A file ready to save: its name, what it holds, and the button that saves its bytes as they are. */
function FileLine({
  name,
  detail,
  label,
  onSave,
}: {
  name: string;
  detail: string;
  label: string;
  onSave: () => void;
}): JSX.Element {
  return (
    <div className="ex-file">
      <div className="ex-file__what">
        <p className="ex-file__name nv-num">{name}</p>
        <p className="ex-sub">{detail}</p>
      </div>
      <button type="button" className="nv-btn nv-btn--neon nv-btn--sm" onClick={onSave}>
        {label}
      </button>
    </div>
  );
}

/** What a file leaves aside: amber, never red; the export is right, the accountant only finishes it. */
function Notice({
  title,
  text,
  children,
}: {
  title: string;
  text: string | null;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="rp-notice" data-tone="warn" role="status">
      <p className="rp-notice__title">{title}</p>
      {text === null ? null : <p className="rp-notice__text">{text}</p>}
      <ul className="ex-notice__list">{children}</ul>
    </div>
  );
}

function RefusalLine({
  refusal,
  what,
}: {
  refusal: ExportRefusal;
  what: 'journal' | 'das2' | 'archive';
}): JSX.Element {
  return (
    <p className="tm-warn sc-refusal nv-swap" role="alert">
      {refusalText(refusal, what)}
      {refusal.kind === 'accounts_missing' ? (
        <>
          {' '}
          Le comptable les donne ; ils se saisissent dans{' '}
          <Link to="/reglages/facturation" className="ex-link">
            Réglages › Facturation
          </Link>
          .
        </>
      ) : null}
    </p>
  );
}

function refusalText(refusal: ExportRefusal, what: 'journal' | 'das2' | 'archive'): string {
  switch (refusal.kind) {
    case 'accounts_missing':
      return missingAccountsText(refusal.missing);
    case 'invalid':
      return what === 'das2'
        ? 'Cette année ne convient pas : une année passée ou en cours.'
        : 'Cette période ne convient pas : la fin après le début, deux ans au plus.';
    case 'forbidden':
      return 'Seul le propriétaire télécharge les exports.';
    case 'failed':
      return 'Le serveur ne répond pas : aucun fichier n’est prêt. Réessaie.';
  }
}
