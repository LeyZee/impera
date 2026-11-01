import type { RestoreTest } from '@nirvana/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { PasswordStep, SignInAgain } from './PasswordStep';
import { recordRestoreTest, type Outcome } from './api';
import {
  bodyOf,
  durationOf,
  emptyDraft,
  problemsOf,
  readReport,
  REFUSALS,
  testedDay,
  withReport,
  type DraftField,
  type RestoreDraft,
} from './model';

import { backupStatusQuery } from '@/screens/dashboard/backups';

const STEP_TITLES = ['Compte rendu', 'Vérifier'] as const;

const SAMPLE = [
  'export sha256: 3f1c…',
  'restored in 252 s, worker queue emptied',
  'row counts: all 31 tables match',
].join('\n');

/** Why the test was not recorded, when the server did not refuse it: each answer in its own words. */
const NOT_RECORDED: Record<Exclude<Outcome['kind'], 'ok' | 'refused' | 'reauth'>, string> = {
  failed: 'L’essai n’a pas été noté : le serveur ne répond pas. Réessaie dans un instant.',
  rate_limited: 'L’essai n’a pas été noté : trop de requêtes d’un coup. Réessaie dans une minute.',
  session_expired: 'L’essai n’a pas été noté : ta session a expiré. Reconnecte-toi.',
};

/** A message under the fields; `signIn` adds « Se reconnecter ». */
interface Failure {
  readonly message: string;
  readonly signIn: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled])';

type Phase =
  | { readonly kind: 'report' }
  | { readonly kind: 'check' }
  | { readonly kind: 'password' }
  | { readonly kind: 'done'; readonly test: RestoreTest };

/**
 * « Noter un essai » (ADR 0028 § 6, EQ-17): the report of the restore session pasted, read into the fields, checked,
 * then sent. Two steps, so the owner reads what will be recorded before it is. The test's id is made when the dialog
 * opens: a retry after a lost answer, or after the password, records it once.
 */
export function RestoreTestDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const dialog = useRef<HTMLDivElement>(null);
  const [testId] = useState(() => crypto.randomUUID());
  const [phase, setPhase] = useState<Phase>({ kind: 'report' });
  const [report, setReport] = useState('');
  const [unread, setUnread] = useState(false);
  const [readFromReport, setReadFromReport] = useState(false);
  const [draft, setDraft] = useState<RestoreDraft>(() => emptyDraft(new Date()));
  // The fields say what is wrong once « Noter l’essai » was pressed, and stop as each is fixed.
  const [attempted, setAttempted] = useState(false);
  const [refused, setRefused] = useState<{ readonly field: DraftField; readonly message: string } | null>(
    null,
  );
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  const shown: Partial<Record<DraftField, string>> = {
    ...(attempted ? problemsOf(draft, new Date()) : {}),
    ...(refused === null ? {} : { [refused.field]: refused.message }),
  };

  const close = (): void => {
    if (!busy) onClose();
  };

  // Back to « Noter un essai » when the dialog closes.
  useEffect(() => {
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // Each step takes the focus on its first field; the password step takes it itself.
  useEffect(() => {
    if (phase.kind === 'password') return;
    dialog.current
      ?.querySelector<HTMLElement>(
        '.bk-dialog__body textarea, .bk-dialog__body input, .bk-dialog__body button',
      )
      ?.focus();
  }, [phase.kind]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab' || dialog.current === null) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const readThenCheck = (): void => {
    if (report.trim() === '') {
      setPhase({ kind: 'check' });
      return;
    }
    const reading = readReport(report);
    if (Object.keys(reading).length === 0) {
      setUnread(true);
      return;
    }
    setDraft((before) => withReport(before, reading));
    setReadFromReport(true);
    setPhase({ kind: 'check' });
  };

  const change = (field: DraftField, value: string): void => {
    setDraft((before) => ({ ...before, [field]: value }));
    if (refused?.field === field) setRefused(null);
    setFailure(null);
  };

  const send = async (): Promise<void> => {
    setAttempted(true);
    const body = bodyOf(draft, testId, new Date());
    if (body === null) {
      setPhase({ kind: 'check' });
      return;
    }
    setBusy(true);
    setFailure(null);
    const outcome = await recordRestoreTest(body);
    setBusy(false);
    if (outcome.kind === 'ok') {
      setPhase({ kind: 'done', test: outcome.value });
      await client.invalidateQueries({ queryKey: backupStatusQuery.queryKey });
      return;
    }
    if (outcome.kind === 'reauth') {
      setPhase({ kind: 'password' });
      return;
    }
    setPhase({ kind: 'check' });
    if (outcome.kind !== 'refused') {
      setFailure({ message: NOT_RECORDED[outcome.kind], signIn: outcome.kind === 'session_expired' });
      return;
    }
    const refusal = REFUSALS[outcome.code];
    if (refusal.field === null) setFailure({ message: refusal.message, signIn: false });
    else setRefused({ field: refusal.field, message: refusal.message });
  };

  const step = phase.kind === 'report' ? 0 : 1;

  return createPortal(
    <div
      className="bk-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        className="nv-glass nv-glass--float bk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onKeyDown={onKeyDown}
      >
        <header className="bk-dialog__head">
          <div className="bk-dialog__title">
            <h2 id={`${id}-title`}>
              {phase.kind === 'done' ? 'Essai noté' : 'Noter un essai de restauration'}
            </h2>
            {phase.kind === 'done' ? null : (
              <ol className="bk-progress" aria-label="Étapes">
                {STEP_TITLES.map((title, index) => (
                  <li
                    key={title}
                    data-state={index < step ? 'done' : index === step ? 'now' : 'later'}
                    aria-current={index === step ? 'step' : undefined}
                  >
                    <span className="bk-progress__num">{String(index + 1)}</span>
                    {title}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <button type="button" className="nv-close" aria-label="Fermer" disabled={busy} onClick={close}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        {phase.kind === 'done' ? (
          <Done test={phase.test} onClose={onClose} />
        ) : phase.kind === 'report' ? (
          <form
            className="bk-dialog__body nv-swap"
            key="report"
            onSubmit={(event) => {
              event.preventDefault();
              readThenCheck();
            }}
          >
            <Field id={`${id}-report`} label="Compte rendu de l’essai" problem={undefined}>
              <textarea
                id={`${id}-report`}
                className="nv-field__control nv-glass bk-report"
                rows={5}
                spellCheck={false}
                placeholder={SAMPLE}
                value={report}
                aria-describedby={`${id}-report-hint`}
                onChange={(event) => {
                  setReport(event.target.value);
                  setUnread(false);
                }}
              />
              <span id={`${id}-report-hint`} className="bk-hint">
                Colle tout ce que la session t’a donné. Seuls l’empreinte, la durée et le nombre de tables qui
                diffèrent en sont gardés.
              </span>
            </Field>
            {unread ? (
              <p className="bk-warn nv-swap" role="alert">
                Je n’y trouve ni empreinte, ni durée, ni comptes de lignes. Vérifie que c’est bien le compte
                rendu, ou saisis l’essai à la main.
              </p>
            ) : null}
            <div className="bk-dialog__foot">
              <button
                type="button"
                className="nv-btn nv-btn--plain"
                onClick={() => {
                  setPhase({ kind: 'check' });
                }}
              >
                Saisir à la main
              </button>
              <button type="submit" className="nv-btn nv-btn--neon">
                Continuer
              </button>
            </div>
          </form>
        ) : (
          <form
            className="bk-dialog__body nv-swap"
            key="check"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            {readFromReport ? (
              <p className="bk-hint">
                Lu dans le compte rendu. Vérifie avant de noter : rien n’est encore envoyé.
              </p>
            ) : null}
            <CheckFields id={id} draft={draft} problems={shown} disabled={busy} onChange={change} />
            {failure === null ? null : (
              <p className="bk-warn nv-swap" role="alert">
                {failure.message}
              </p>
            )}
            {failure?.signIn === true ? <SignInAgain /> : null}
            {phase.kind === 'password' ? (
              <PasswordStep
                hint="Pour noter un essai, confirme ton mot de passe."
                onConfirmed={() => {
                  void send();
                }}
                onCancel={() => {
                  setPhase({ kind: 'check' });
                }}
              />
            ) : (
              <div className="bk-dialog__foot">
                <button
                  type="button"
                  className="nv-btn nv-btn--plain"
                  disabled={busy}
                  onClick={() => {
                    setAttempted(false);
                    setRefused(null);
                    setFailure(null);
                    setPhase({ kind: 'report' });
                  }}
                >
                  Retour
                </button>
                <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
                  {busy ? 'Enregistrement…' : 'Noter l’essai'}
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Field({
  id,
  label,
  hint,
  problem,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  problem: string | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="nv-field bk-field" data-invalid={problem === undefined ? undefined : 'true'}>
      <label className="nv-field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {problem === undefined ? (
        hint === undefined ? null : (
          <span id={`${id}-hint`} className="bk-hint">
            {hint}
          </span>
        )
      ) : (
        <span id={`${id}-hint`} className="bk-hint bk-hint--error" role="alert">
          {problem}
        </span>
      )}
    </div>
  );
}

function CheckFields({
  id,
  draft,
  problems,
  disabled,
  onChange,
}: {
  id: string;
  draft: RestoreDraft;
  problems: Partial<Record<DraftField, string>>;
  disabled: boolean;
  onChange: (field: DraftField, value: string) => void;
}): JSX.Element {
  const seconds = Number(draft.durationSeconds);
  const mismatches = Number(draft.rowCountMismatches);
  const control = (field: DraftField) => ({
    id: `${id}-${field}`,
    className: 'nv-field__control nv-glass',
    disabled,
    'aria-invalid': problems[field] !== undefined,
    'aria-describedby': `${id}-${field}-hint`,
  });
  return (
    <>
      <Field
        id={`${id}-sha256`}
        label="Empreinte de la sauvegarde"
        hint={'La ligne « export sha256 » : 64\u00a0caractères.'}
        problem={problems.sha256}
      >
        <input
          {...control('sha256')}
          className="nv-field__control nv-glass bk-mono"
          autoComplete="off"
          spellCheck={false}
          value={draft.sha256}
          onChange={(event) => {
            onChange('sha256', event.target.value);
          }}
        />
      </Field>
      <Field
        id={`${id}-testedAt`}
        label="Fin de l’essai"
        hint="Quand les lignes ont été comptées."
        problem={problems.testedAt}
      >
        <input
          {...control('testedAt')}
          className="nv-field__control nv-glass bk-when"
          type="datetime-local"
          value={draft.testedAt}
          onChange={(event) => {
            onChange('testedAt', event.target.value);
          }}
        />
      </Field>
      <div className="bk-pair">
        <Field
          id={`${id}-durationSeconds`}
          label="Durée de la restauration"
          hint={
            Number.isInteger(seconds) && seconds > 0
              ? `En secondes : ${durationOf(seconds)}.`
              : 'En secondes (« restored in … s »).'
          }
          problem={problems.durationSeconds}
        >
          <input
            {...control('durationSeconds')}
            inputMode="numeric"
            value={draft.durationSeconds}
            onChange={(event) => {
              onChange('durationSeconds', event.target.value);
            }}
          />
        </Field>
        <Field
          id={`${id}-rowCountMismatches`}
          label="Tables qui diffèrent"
          hint={
            draft.rowCountMismatches.trim() !== '' && Number.isInteger(mismatches) && mismatches > 0 ? (
              <span className="bk-hint--warn">Noté, mais la paie attendra un essai réussi.</span>
            ) : (
              '0 quand toutes correspondent.'
            )
          }
          problem={problems.rowCountMismatches}
        >
          <input
            {...control('rowCountMismatches')}
            inputMode="numeric"
            value={draft.rowCountMismatches}
            onChange={(event) => {
              onChange('rowCountMismatches', event.target.value);
            }}
          />
        </Field>
      </div>
      <Field
        id={`${id}-notes`}
        label="Note (facultatif)"
        hint="Ce qui mérite d’être retenu de l’essai, jamais une donnée de fan."
        problem={problems.notes}
      >
        <textarea
          {...control('notes')}
          rows={2}
          maxLength={500}
          value={draft.notes}
          onChange={(event) => {
            onChange('notes', event.target.value);
          }}
        />
      </Field>
    </>
  );
}

function Done({ test, onClose }: { test: RestoreTest; onClose: () => void }): JSX.Element {
  const day = testedDay(test.testedAt);
  return (
    <div className="bk-dialog__body nv-swap" key="done">
      <p className="bk-done">
        <span
          className="bk-dot"
          data-tone={test.rowCountMismatches === 0 ? 'ok' : 'warn'}
          aria-hidden="true"
        />
        {test.rowCountMismatches === 0
          ? `Essai du ${day} : restauré en ${durationOf(test.durationSeconds)}, toutes les lignes retrouvées.`
          : `Essai du ${day} : ${String(test.rowCountMismatches)} ${test.rowCountMismatches > 1 ? 'tables différaient' : 'table différait'}. La paie attend un essai réussi.`}
      </p>
      <div className="bk-dialog__foot">
        <button type="button" className="nv-btn nv-btn--soft" onClick={onClose}>
          Fermer
        </button>
      </div>
    </div>
  );
}
