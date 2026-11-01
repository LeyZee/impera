import type { AgencyLogo, BillingSettings } from '@nirvana/contracts';
import { useState, type JSX, type ReactNode } from 'react';

import { BillingDialog } from './BillingDialog';
import { logoUrl, useBillingSettings } from './api';
import {
  ALL_STEPS,
  dueText,
  closeChoiceText,
  footText,
  formLine,
  isReady,
  logoLine,
  logoWarning,
  sirenText,
  type StepKey,
} from './model';

import '@/reports/reports.css';
import '@/scheduling/scheduling.css';
import '@/screens/team/team.css';
import './billing.css';

interface Opened {
  readonly title: string;
  readonly steps: readonly StepKey[];
}

/** The first filling walks every step; each card opens the steps of what it shows, under its own title. */
const SETUP: Opened = { title: 'Réglages de facturation', steps: ALL_STEPS };
const CARDS = {
  agency: { title: 'L’agence', steps: ['agency', 'registration'] },
  service: { title: 'Désignation de la prestation', steps: ['service'] },
  payment: { title: 'Paiement', steps: ['payment'] },
  logo: { title: 'Logo', steps: ['logo'] },
} as const satisfies Readonly<Record<string, Opened>>;

/**
 * Réglages › Facturation (EQ-06), the owner's alone: what each invoice and credit note says of the agency, which issues
 * them in the name and on behalf of each contractor (self-billing). Until
 * it is saved, no invoice is issued (`agency_missing`): the page then asks for it before anything else. An invoice
 * issued keeps its own copy; a change only reaches the next ones.
 */
export function BillingSection(): JSX.Element {
  const query = useBillingSettings();
  const [open, setOpen] = useState<Opened | null>(null);

  if (query.isError) {
    return (
      <section className="rp-rules bf">
        <div className="nv-plate rp-rules__cover nv-enter">
          <p className="rp-notice__title">Le serveur ne répond pas</p>
          <p className="rp-notice__text">
            Les réglages de facturation n’ont pas pu être lus. Réessaie dans un instant.
          </p>
          <button
            type="button"
            className="nv-btn nv-btn--soft tm-self-start"
            onClick={() => {
              void query.refetch();
            }}
          >
            Réessayer
          </button>
        </div>
      </section>
    );
  }
  if (query.data === undefined) {
    return (
      <section className="rp-rules bf" aria-busy="true" aria-label="Facturation">
        <div className="sc-skeleton" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </section>
    );
  }

  const view = query.data;
  const { settings } = view;
  return (
    <section className="rp-rules bf">
      <p className="rp-rules__lede nv-enter">
        Ce que chaque facture et chaque avoir disent de l’agence, qui les établit au nom de chaque
        prestataire. Une facture émise garde sa copie : un changement ne vaut que pour les suivantes.
      </p>
      {settings === null ? (
        <Setup
          onStart={() => {
            setOpen(SETUP);
          }}
        />
      ) : (
        <Cards settings={settings} logo={view.logo} onChange={setOpen} />
      )}
      {open === null ? null : (
        <BillingDialog
          view={view}
          title={open.title}
          steps={open.steps}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </section>
  );
}

function Setup({ onStart }: { onStart: () => void }): JSX.Element {
  return (
    <div className="rp-notice nv-enter" data-tone="warn" style={{ '--nv-i': 1 }}>
      <p className="rp-notice__title">Aucune facture ne part</p>
      <p className="rp-notice__text">
        Tant que ces réglages ne sont pas enregistrés, un relevé validé reste sans facture. Garde le Kbis sous
        la main, et les conditions de paiement validées par ton comptable.
      </p>
      <button type="button" className="nv-btn nv-btn--neon tm-self-start" onClick={onStart}>
        Remplir les réglages
      </button>
    </div>
  );
}

function Cards({
  settings,
  logo,
  onChange,
}: {
  settings: BillingSettings;
  logo: AgencyLogo | null;
  onChange: (opened: Opened) => void;
}): JSX.Element {
  const { agency } = settings;
  const form = formLine(agency);
  const warning = logo === null ? null : logoWarning(logo);
  return (
    <>
      {isReady(settings) ? null : (
        <div className="rp-notice nv-enter" data-tone="warn" style={{ '--nv-i': 1 }}>
          <p className="rp-notice__title">Aucune facture ne part</p>
          <p className="rp-notice__text">
            La désignation de la prestation manque : sans elle, un relevé validé reste sans facture.
          </p>
          <button
            type="button"
            className="nv-btn nv-btn--neon tm-self-start"
            onClick={() => {
              onChange(CARDS.service);
            }}
          >
            Écrire la désignation
          </button>
        </div>
      )}
      <Card
        index={1}
        title={CARDS.agency.title}
        sub="En tête de chaque facture, et en pied de chaque page"
        onChange={() => {
          onChange(CARDS.agency);
        }}
      >
        <dl className="bf-facts">
          <Fact label="Raison sociale">{agency.legalName}</Fact>
          <Fact label="Forme et capital">{form ?? <span className="bf-missing">À remplir</span>}</Fact>
          <Fact label="Siège">
            <span className="bf-lines">{agency.address}</span>
          </Fact>
          <Fact label="SIREN">
            <span className="nv-num">{sirenText(agency.siren)}</span>
          </Fact>
          <Fact label="RCS">{agency.rcsCity ?? <span className="bf-missing">À remplir</span>}</Fact>
          <Fact label="TVA intracommunautaire">
            <span className="nv-num">{agency.vatNumber}</span>
          </Fact>
          <Fact label="Clôture de l’exercice">{closeChoiceText(settings.fiscalYearEndMonth)}</Fact>
        </dl>
        <p className="bf-label">Pied de chaque page</p>
        <p className="bf-paper bf-paper--foot">{footText(agency)}</p>
      </Card>
      <Card
        index={2}
        title={CARDS.service.title}
        sub="Au-dessus des lignes de chaque facture"
        onChange={() => {
          onChange(CARDS.service);
        }}
      >
        {settings.serviceDescription === null ? (
          <p className="bf-missing">À écrire</p>
        ) : (
          <p className="bf-quote">{settings.serviceDescription}</p>
        )}
      </Card>
      <Card
        index={3}
        title={CARDS.payment.title}
        sub="Sous le total de chaque facture"
        onChange={() => {
          onChange(CARDS.payment);
        }}
      >
        <dl className="bf-facts">
          <Fact label="Échéance">{dueText(settings.dueDays)}</Fact>
          <Fact label="Conditions">
            <span className="bf-terms">{settings.paymentTerms}</span>
          </Fact>
        </dl>
      </Card>
      <Card
        index={4}
        title={CARDS.logo.title}
        sub="En tête de chaque facture et de chaque avoir"
        onChange={() => {
          onChange(CARDS.logo);
        }}
      >
        <div className="bf-paper bf-paper--logo">
          {logo === null ? (
            <p className="bf-paper__none">Aucun logo : la facture imprime la raison sociale seule.</p>
          ) : (
            <img src={logoUrl(logo.sha256)} alt={`Logo de ${agency.legalName}`} />
          )}
        </div>
        {logo === null ? null : <p className="tm-hint nv-num">{logoLine(logo)}</p>}
        {warning === null ? null : <p className="tm-warn">{warning}</p>}
      </Card>
    </>
  );
}

function Card({
  index,
  title,
  sub,
  onChange,
  children,
}: {
  index: number;
  title: string;
  sub: string;
  onChange: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="nv-plate rp-account nv-enter" style={{ '--nv-i': Math.min(index + 1, 8) }}>
      <div className="rp-account__head">
        <div className="rp-account__who">
          <h2 className="rp-account__name">{title}</h2>
          <p className="rp-account__handle">{sub}</p>
        </div>
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm"
          aria-label={`Changer : ${title}`}
          onClick={onChange}
        >
          Changer
        </button>
      </div>
      <div className="bf-card__body">{children}</div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
