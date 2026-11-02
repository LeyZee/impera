import {
  CONTRACTOR_DOCUMENT_MAX_BYTES,
  CONTRACTOR_DOCUMENT_MEDIA_TYPES,
  ContractorDocumentIdSchema,
  DOCUMENT_REFUSAL_REASON_MAX,
  type BillingRegime,
  type ContractorDocumentKind,
  type ContractorFile,
  type ContractorFileDocument,
  type ContractText,
} from '@nirvana/contracts';
import { useId, useState, type JSX, type ReactNode, type SyntheticEvent } from 'react';

import { BeninGuide } from './BeninGuide';

import {
  acceptText,
  documentFileUrl,
  reviewDocument,
  uploadDocument,
  useRefreshFile,
} from '@/contractors/api';
import {
  DOCUMENT_NAMES,
  TEXT_KINDS,
  TEXT_NAMES,
  dayText,
  documentDatesText,
  documentStanding,
  documentStateText,
  identityLines,
  olderDocuments,
  reminderText,
  textStanding,
  type DocumentStanding,
  type TextStanding,
} from '@/contractors/model';
import '@/contractors/contractors.css';
import type { InvoiceOutcome, InvoiceRefusal } from '@/invoices/api';
import { invoiceRefusalText } from '@/invoices/model';
import { countryName } from '@/lib/country';
import { Dialog } from '@/screens/team/Dialog';
import { weightText } from '@/settings/billing/model';
import { Panel } from '@/shell/layout';

/**
 * The parts of a contractor's file (EQ-06 lot 8b) that Moi › Dossier and the owner's Équipe › Membres › Dossier share:
 * his identity, his contract and mandate, his documents. `self` is the contractor reading his own: he fills, accepts
 * and files; the owner reads, checks and reviews, never on his own file.
 */

/** Who reads the file: the contractor himself, or the owner, who checks it unless it is his own. */
export interface FileReader {
  readonly self: boolean;
  /** The owner on another member's file: he checks the identity and reviews each document, once. */
  readonly checks: boolean;
}

/** A refusal that says the file changed under the screen: it reads the file again, and the sentence stays. */
const readsAgain = (refusal: InvoiceRefusal): boolean =>
  refusal.kind === 'refused' && (refusal.code.endsWith('_conflict') || refusal.code.endsWith('_not_found'));

/** A write's ending: done, the file read again and the dialog closed; refused, its sentence. */
export function useFileSend(onDone: () => void): {
  busy: boolean;
  refusal: InvoiceRefusal | null;
  send: (write: () => Promise<InvoiceOutcome<unknown>>) => void;
} {
  const refresh = useRefreshFile();
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

export function Refusal({ refusal }: { refusal: InvoiceRefusal | null }): JSX.Element | null {
  return refusal === null ? null : (
    <p className="tm-warn sc-refusal nv-swap" role="alert">
      {invoiceRefusalText(refusal)}
    </p>
  );
}

type Tone = 'ok' | 'wait' | 'warn';

function Chip({ tone, children }: { tone: Tone; children: ReactNode }): JSX.Element {
  return <span className={`rp-chip rp-chip--${tone}`}>{children}</span>;
}

/** The identity his invoices print: who, where, his registration, as the file holds it, with the owner's check. */
export function IdentityFacts({
  file,
  reader,
  timeZone,
}: {
  file: ContractorFile;
  reader: FileReader;
  timeZone: string;
}): JSX.Element | null {
  const profile = file.profile;
  if (profile === null) return null;
  return (
    <div className="rp-sec">
      <div className="cf-state">
        {profile.verifiedAt === null ? (
          <Chip tone={reader.checks ? 'warn' : 'wait'}>
            {reader.checks ? 'À vérifier' : 'En attente de vérification'}
          </Chip>
        ) : (
          <Chip tone="ok">Vérifié le {dayText(profile.verifiedAt, timeZone)}</Chip>
        )}
      </div>
      <dl className="tm-facts cf-facts">
        {identityLines(profile).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={label === 'E-mail des factures' ? 'tm-mail' : undefined}>{value}</dd>
          </div>
        ))}
        <div>
          <dt>Pays</dt>
          <dd>{countryName(file.country)}</dd>
        </div>
        <div>
          <dt>Préfixe des factures</dt>
          <dd className="nv-num">
            {profile.invoicePrefix ??
              (reader.self ? 'Posé par le propriétaire avant ta première facture' : 'Aucun')}
            {profile.invoicePrefix !== null && file.prefixFrozen ? (
              <span className="cf-quiet"> · figé par la première facture</span>
            ) : null}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** His contract and his mandate: the newest version of each, accepted or to accept, and its text to read. */
export function TextsPanel({
  file,
  texts,
  reader,
  timeZone,
  onRead,
}: {
  file: ContractorFile;
  texts: readonly ContractText[];
  reader: FileReader;
  timeZone: string;
  onRead: (text: ContractText, standing: TextStanding) => void;
}): JSX.Element {
  return (
    <Panel className="nv-enter" eyebrow="Contrat et mandat" title={reader.self ? 'Tes textes' : 'Ses textes'}>
      <ul className="cf-list">
        {TEXT_KINDS.map((kind) => {
          const standing = textStanding(kind, texts, file.acceptances);
          return (
            <li key={kind} className="cf-item">
              <div className="cf-item__main">
                <p className="cf-item__name">{TEXT_NAMES[kind]}</p>
                <p className="cf-item__sub">{textLine(standing, reader, timeZone)}</p>
              </div>
              <div className="cf-item__chips">
                {standing.kind === 'none' ? (
                  <Chip tone="wait">Pas encore publié</Chip>
                ) : standing.kind === 'accepted' ? (
                  <Chip tone="ok">Accepté</Chip>
                ) : (
                  <Chip tone="warn">{reader.self ? 'À accepter' : 'Pas encore accepté'}</Chip>
                )}
              </div>
              <div className="cf-item__acts">
                {standing.kind === 'none' ? null : (
                  <button
                    type="button"
                    className={
                      reader.self && standing.kind === 'to_accept'
                        ? 'nv-btn nv-btn--soft nv-btn--sm'
                        : 'nv-btn nv-btn--plain nv-btn--sm'
                    }
                    onClick={() => {
                      onRead(standing.text, standing);
                    }}
                  >
                    {reader.self && standing.kind === 'to_accept' ? 'Lire et accepter' : 'Lire'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function textLine(standing: TextStanding, reader: FileReader, timeZone: string): string {
  switch (standing.kind) {
    case 'none':
      return 'L’agence ne l’a pas encore publié dans l’application.';
    case 'accepted':
      return `Version ${String(standing.text.version)}, acceptée le ${dayText(standing.at, timeZone)}${delayText(standing.text)}.`;
    case 'to_accept':
      return standing.before === null
        ? `Version ${String(standing.text.version)}${delayText(standing.text)}.`
        : `Version ${String(standing.text.version)}, nouvelle : ${reader.self ? 'tu avais accepté' : 'il avait accepté'} la version ${String(standing.before.version)} le ${dayText(standing.before.at, timeZone)}.`;
  }
}

const delayText = (text: ContractText): string =>
  text.contestDelayDays === null
    ? ''
    : ` · ${String(text.contestDelayDays)} jour${text.contestDelayDays > 1 ? 's' : ''} pour contester une facture`;

/** A text read in full, the version accepted only as read: its fingerprint goes with the acceptance. */
export function TextDialog({
  text,
  standing,
  reader,
  onClose,
}: {
  text: ContractText;
  standing: TextStanding;
  reader: FileReader;
  onClose: () => void;
}): JSX.Element {
  const { busy, refusal, send } = useFileSend(onClose);
  const accepting = reader.self && standing.kind === 'to_accept';
  return (
    <Dialog
      title={`${TEXT_NAMES[text.kind]}, version ${String(text.version)}`}
      lead={
        accepting
          ? 'Lis-le en entier : ton acceptation est datée et garde l’empreinte de ce texte.'
          : 'Le texte tel que l’agence l’a publié.'
      }
      busy={busy}
      className="cf-text-dialog"
      onClose={onClose}
    >
      <form
        className="tm-dialog__body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (accepting && !busy) send(() => acceptText(text.id, text.sha256));
        }}
      >
        <div className="cf-text nv-glass" tabIndex={0} aria-label="Texte">
          {text.body}
        </div>
        <Refusal refusal={refusal} />
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            {accepting ? 'Plus tard' : 'Fermer'}
          </button>
          {accepting ? (
            <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
              {busy ? 'Envoi…' : `J’accepte la version ${String(text.version)}`}
            </button>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}

/** What each document's standing is called, by who reads it. */
function standingChip(standing: DocumentStanding, reader: FileReader): JSX.Element {
  switch (standing.kind) {
    case 'missing':
      return <Chip tone="warn">À envoyer</Chip>;
    case 'pending':
      return (
        <Chip tone={reader.checks ? 'warn' : 'wait'}>{reader.checks ? 'À examiner' : 'En attente'}</Chip>
      );
    case 'accepted':
      return <Chip tone="ok">Acceptée</Chip>;
    case 'expired':
      // Amber, never red: a document to renew is a warning (the guide).
      return <Chip tone="warn">Échue</Chip>;
    case 'refused':
      return <Chip tone="warn">Refusée</Chip>;
  }
}

/** One document of the file: its dates, its check and its reason, its file. */
function DocumentLine({
  memberId,
  document,
  today,
  reader,
  onReview,
}: {
  memberId: string;
  document: ContractorFileDocument;
  /** The file's day: an accepted document past it reads « échue ». */
  today: string;
  reader: FileReader;
  onReview: (document: ContractorFileDocument) => void;
}): JSX.Element {
  return (
    <>
      <p className="cf-item__sub">
        {documentDatesText(document)} · {documentStateText(document, today)}
      </p>
      {document.review?.decision === 'refused' ? (
        <p className="cf-item__reason">Motif : « {document.review.reason} »</p>
      ) : null}
      <div className="cf-item__acts">
        {document.purgedAt === null ? (
          <a
            className="nv-btn nv-btn--plain nv-btn--sm"
            href={documentFileUrl(memberId, document.id)}
            download
          >
            Voir le fichier
          </a>
        ) : (
          <span className="cf-quiet">Fichier effacé</span>
        )}
        {reader.checks && document.review === null ? (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            onClick={() => {
              onReview(document);
            }}
          >
            Examiner
          </button>
        ) : null}
      </div>
    </>
  );
}

/**
 * The documents his regime asks for: each kind's standing, its reminder from `remindFrom`, the older ones kept. A
 * chatter of Benin reads the guide of the tax residence certificate under it, word for word.
 */
export function DocumentsPanel({
  file,
  regime,
  reader,
  name,
  onUpload,
  onReview,
}: {
  file: ContractorFile;
  /** The regime in force, read from the regimes' list; `null` without one. */
  regime: BillingRegime | null;
  reader: FileReader;
  /** The member's name, for the owner's sentences. */
  name: string;
  onUpload: (kind: ContractorDocumentKind) => void;
  onReview: (document: ContractorFileDocument) => void;
}): JSX.Element {
  const year = file.today.slice(0, 4);
  // Whether the tax residence certificate gates the payouts (`treatyNeedsResidence`, ADR 0041), or only warns.
  const treaty = regime?.withholding === 'treaty_exempt';
  return (
    <Panel className="nv-enter" eyebrow="Pièces" title={reader.self ? 'Tes pièces' : 'Ses pièces'}>
      {regime === null ? (
        <p className="py-quiet">
          {reader.self
            ? 'Aucun régime de facturation pour l’instant : le propriétaire t’en attribue un selon ton pays, et les pièces qu’il demande s’afficheront ici.'
            : `${name} n’a pas encore de régime : attribue-lui celui de son pays pour voir les pièces qu’il demande.`}
        </p>
      ) : regime.documents.length === 0 ? (
        <p className="py-quiet">
          {reader.self ? 'Ton régime ne demande aucune pièce.' : 'Son régime ne demande aucune pièce.'}
        </p>
      ) : (
        <ul className="cf-list">
          {regime.documents.map((kind) => {
            const standing = documentStanding(kind, file.documents, file.today);
            const older = olderDocuments(kind, file.documents, standing);
            const shown = standing.kind === 'missing' ? null : standing.document;
            const reminder = shown === null ? null : reminderText(shown, file.today, reader.self, treaty);
            return (
              <li
                key={kind}
                className="cf-item cf-item--doc"
                data-remind={reminder === null ? undefined : 'true'}
              >
                <div className="cf-item__main">
                  <p className="cf-item__name">{DOCUMENT_NAMES[kind]}</p>
                  {shown === null ? (
                    <p className="cf-item__sub">
                      {reader.self ? 'Pas encore déposée.' : `${name} ne l’a pas encore déposée.`}
                    </p>
                  ) : (
                    <DocumentLine
                      memberId={file.memberId}
                      document={shown}
                      today={file.today}
                      reader={reader}
                      onReview={onReview}
                    />
                  )}
                  {reminder === null ? null : <p className="tm-warn cf-remind">{reminder}</p>}
                </div>
                <div className="cf-item__chips">{standingChip(standing, reader)}</div>
                {reader.self ? (
                  <div className="cf-item__acts cf-item__acts--side">
                    <button
                      type="button"
                      className="nv-btn nv-btn--soft nv-btn--sm"
                      onClick={() => {
                        onUpload(kind);
                      }}
                    >
                      {standing.kind === 'missing' || standing.kind === 'refused'
                        ? 'Déposer'
                        : 'Déposer une nouvelle'}
                    </button>
                  </div>
                ) : null}
                {/* The guide says the money cannot leave without the certificate: true under a treaty alone. */}
                {reader.self && kind === 'tax_residence' && file.country === 'BJ' && treaty ? (
                  <details className="cf-guide">
                    <summary>Comment obtenir ton attestation</summary>
                    <BeninGuide year={year} />
                  </details>
                ) : null}
                {older.length === 0 ? null : (
                  <details className="cf-older">
                    <summary>
                      {older.length === 1
                        ? 'Une pièce précédente'
                        : `${String(older.length)} pièces précédentes`}
                    </summary>
                    <ul className="cf-list">
                      {older.map((document) => (
                        <li key={document.id} className="cf-item cf-item--old">
                          <div className="cf-item__main">
                            <DocumentLine
                              memberId={file.memberId}
                              document={document}
                              today={file.today}
                              reader={reader}
                              onReview={onReview}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

const ACCEPTED_FILES = [...CONTRACTOR_DOCUMENT_MEDIA_TYPES, '.pdf', '.jpg', '.jpeg', '.png'].join(',');
const KNOWN_TYPES: ReadonlySet<string> = new Set(CONTRACTOR_DOCUMENT_MEDIA_TYPES);

/** What is wrong with a chosen file before it leaves, or `null`: the server reads its bytes and decides anyway. */
export function fileProblem(file: Pick<File, 'size' | 'type'>): string | null {
  if (file.size > CONTRACTOR_DOCUMENT_MAX_BYTES)
    return `Ce fichier pèse ${weightText(file.size)} : ${weightText(CONTRACTOR_DOCUMENT_MAX_BYTES)} au plus.`;
  if (file.type !== '' && !KNOWN_TYPES.has(file.type))
    return 'Un PDF, ou la photo de la pièce en JPEG ou en PNG.';
  return null;
}

/**
 * A document filed: its file, its date of issue and, for a vigilance certificate, the end it states. The key that
 * makes a retry safe is drawn once per file chosen, and kept while that file stays.
 */
export function UploadDialog({
  memberId,
  kind,
  today,
  onClose,
}: {
  memberId: string;
  kind: ContractorDocumentKind;
  today: string;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const { busy, refusal, send } = useFileSend(onClose);
  const [chosen, setChosen] = useState<{ readonly file: File; readonly key: string } | null>(null);
  const [issuedOn, setIssuedOn] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [touched, setTouched] = useState(false);
  const problem = chosen === null ? null : fileProblem(chosen.file);
  const issuedOk = /^\d{4}-\d{2}-\d{2}$/u.test(issuedOn) && issuedOn <= today;
  const untilOk = validUntil === '' || (/^\d{4}-\d{2}-\d{2}$/u.test(validUntil) && validUntil > issuedOn);
  const ready = chosen !== null && problem === null && issuedOk && untilOk;

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    setTouched(true);
    if (busy || !ready) return;
    const documentId = ContractorDocumentIdSchema.parse(chosen.key);
    send(() =>
      uploadDocument(
        memberId,
        { id: documentId, kind, issuedOn, ...(validUntil === '' ? {} : { validUntil }) },
        chosen.file,
      ),
    );
  };

  return (
    <Dialog
      title={`Déposer : ${DOCUMENT_NAMES[kind].toLowerCase()}`}
      lead="Le propriétaire la vérifie ensuite."
      busy={busy}
      onClose={onClose}
    >
      <form className="tm-dialog__body" noValidate onSubmit={submit}>
        <div
          className="nv-field tm-field"
          data-invalid={touched && (chosen === null || problem !== null) ? 'true' : undefined}
        >
          <label className="nv-field__label" htmlFor={`${id}-file`}>
            Le fichier
          </label>
          <input
            id={`${id}-file`}
            type="file"
            className="nv-field__control nv-glass cf-file"
            accept={ACCEPTED_FILES}
            aria-describedby={`${id}-file-hint`}
            data-autofocus
            onChange={(event) => {
              const file = event.target.files?.[0];
              setChosen(file === undefined ? null : { file, key: crypto.randomUUID() });
            }}
          />
          <p
            id={`${id}-file-hint`}
            className={
              touched && (chosen === null || problem !== null) ? 'tm-hint tm-hint--error' : 'tm-hint'
            }
          >
            {problem ??
              (touched && chosen === null
                ? 'Choisis le fichier de la pièce.'
                : `Un PDF, ou une photo nette en JPEG ou en PNG, ${weightText(CONTRACTOR_DOCUMENT_MAX_BYTES)} au plus.`)}
          </p>
        </div>
        <div className="nv-field tm-field" data-invalid={touched && !issuedOk ? 'true' : undefined}>
          <label className="nv-field__label" htmlFor={`${id}-issued`}>
            Délivrée le
          </label>
          <input
            id={`${id}-issued`}
            type="date"
            className="nv-field__control nv-glass nv-num"
            max={today}
            value={issuedOn}
            aria-invalid={touched && !issuedOk}
            aria-describedby={`${id}-issued-hint`}
            onChange={(event) => {
              setIssuedOn(event.target.value);
            }}
          />
          <p id={`${id}-issued-hint`} className={touched && !issuedOk ? 'tm-hint tm-hint--error' : 'tm-hint'}>
            {touched && !issuedOk
              ? 'La date écrite sur la pièce, au plus tard aujourd’hui.'
              : kind === 'tax_residence'
                ? 'La date écrite sur l’attestation : elle vaut pour l’année civile de sa délivrance.'
                : 'La date écrite sur l’attestation.'}
          </p>
        </div>
        {kind === 'tax_residence' ? null : (
          <div className="nv-field tm-field" data-invalid={touched && !untilOk ? 'true' : undefined}>
            <label className="nv-field__label" htmlFor={`${id}-until`}>
              Valable jusqu’au <span className="cf-quiet">(si elle le dit)</span>
            </label>
            <input
              id={`${id}-until`}
              type="date"
              className="nv-field__control nv-glass nv-num"
              value={validUntil}
              aria-invalid={touched && !untilOk}
              aria-describedby={`${id}-until-hint`}
              onChange={(event) => {
                setValidUntil(event.target.value);
              }}
            />
            <p id={`${id}-until-hint`} className={touched && !untilOk ? 'tm-hint tm-hint--error' : 'tm-hint'}>
              {touched && !untilOk
                ? 'La fin suit la date de délivrance.'
                : 'Sans fin écrite, elle tient six mois à partir de sa délivrance.'}
            </p>
          </div>
        )}
        <Refusal refusal={refusal} />
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
            {busy ? 'Envoi…' : 'Déposer'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

type Decision = 'accepted' | 'refused';

/** The owner's check of a document, once: accepted, or refused with the reason the contractor reads. */
export function ReviewDialog({
  memberId,
  name,
  document,
  onClose,
}: {
  memberId: string;
  name: string;
  document: ContractorFileDocument;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const { busy, refusal, send } = useFileSend(onClose);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const trimmed = reason.trim();
  const reasonOk = trimmed !== '' && trimmed.length <= DOCUMENT_REFUSAL_REASON_MAX;

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    setTouched(true);
    if (busy || decision === null) return;
    if (decision === 'accepted') {
      send(() => reviewDocument(memberId, document.id, { decision: 'accepted' }));
      return;
    }
    if (reasonOk) send(() => reviewDocument(memberId, document.id, { decision: 'refused', reason: trimmed }));
  };

  return (
    <Dialog
      title={`Examiner : ${DOCUMENT_NAMES[document.kind].toLowerCase()}`}
      lead={`${name}, ${documentDatesText(document)}. Une seule fois : ta décision ne change plus.`}
      busy={busy}
      onClose={onClose}
    >
      <form className="tm-dialog__body" noValidate onSubmit={submit}>
        {document.purgedAt === null ? (
          <p className="tm-hint">
            <a href={documentFileUrl(memberId, document.id)} download>
              Ouvrir le fichier
            </a>{' '}
            et vérifie le nom, la date et ce qu’il atteste avant de décider.
          </p>
        ) : null}
        <div className="nv-field tm-field" data-invalid={touched && decision === null ? 'true' : undefined}>
          <span className="nv-field__label" id={`${id}-decision`}>
            Ta décision
          </span>
          <div className="tm-choices" role="radiogroup" aria-labelledby={`${id}-decision`}>
            {(
              [
                ['accepted', 'Accepter'],
                ['refused', 'Refuser'],
              ] as const
            ).map(([one, label]) => (
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
            <p className="tm-hint tm-hint--error">Choisis ta décision.</p>
          ) : null}
        </div>
        {decision === 'refused' ? (
          <div className="nv-field tm-field" data-invalid={touched && !reasonOk ? 'true' : undefined}>
            <label className="nv-field__label" htmlFor={`${id}-reason`}>
              Motif
            </label>
            <textarea
              id={`${id}-reason`}
              className="nv-field__control nv-glass sc-note"
              rows={3}
              maxLength={DOCUMENT_REFUSAL_REASON_MAX}
              value={reason}
              placeholder="L’année n’est pas lisible : dépose une photo plus nette."
              aria-invalid={touched && !reasonOk}
              aria-describedby={`${id}-reason-hint`}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
            <p
              id={`${id}-reason-hint`}
              className={touched && !reasonOk ? 'tm-hint tm-hint--error' : 'tm-hint'}
            >
              {touched && !reasonOk
                ? `Le motif est obligatoire, ${String(DOCUMENT_REFUSAL_REASON_MAX)} caractères au plus.`
                : `${name} le lit et dépose une nouvelle pièce.`}
            </p>
          </div>
        ) : null}
        <Refusal refusal={refusal} />
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
            {busy ? 'Envoi…' : decision === 'refused' ? 'Refuser' : 'Accepter'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
