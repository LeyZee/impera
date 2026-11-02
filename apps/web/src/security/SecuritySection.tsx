import type { AccountSecurity, OpenSession } from '@nirvana/contracts';
import { useCallback, useEffect, useId, useRef, useState, type JSX, type SyntheticEvent } from 'react';

import {
  closeAccountSessions,
  closeOtherSessions,
  closeSession,
  fetchAccounts,
  fetchSessions,
  generateBackupCodes,
  SECURITY_ERROR_MESSAGES,
  SecurityError,
} from './api';
import { ago, closedText, ROLE_LABELS, sessionsText } from './view';

import { BackupCodesList } from '@/auth/BackupCodesList';
import { CodeInput } from '@/auth/CodeInput';
import { PasswordPrompt } from '@/settings/services/PasswordPrompt';
import { Panel, PanelSection } from '@/shell/layout';

const messageOf = (error: unknown): string =>
  error instanceof SecurityError ? error.message : SECURITY_ERROR_MESSAGES.unavailable;

const MUTED = 'text-sm text-[var(--nv-ink-muted)]';
const ROWS = 'flex flex-col divide-y divide-[var(--nv-hairline)]';

/**
 * Réglages › Sécurité (ADR 0046 § 7, SEC-04): one's open sessions and backup codes; for the owner, each account's second
 * factor. A session shows its device, its network and when it was last used: never a full address, never a country
 * (no geographic base: Charles's choice of 02/11).
 */
export function SecuritySection({ owner, userId }: { owner: boolean; userId: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <SessionsPanel />
      <BackupCodesPanel />
      {owner ? <AccountsPanel ownerId={userId} /> : null}
    </div>
  );
}

/** What a panel says after an act: the refusal in amber, or what was done. */
function Outcome({ error, notice }: { error: string | null; notice: string | null }): JSX.Element {
  return (
    <p className="text-sm empty:hidden" aria-live="polite">
      {error === null ? notice : <span className="text-[var(--nv-warning)]">{error}</span>}
    </p>
  );
}

function SessionsPanel(): JSX.Element {
  const [sessions, setSessions] = useState<readonly OpenSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await fetchSessions());
      setError(null);
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function close(id: string): Promise<void> {
    setBusy(id);
    setNotice(null);
    try {
      await closeSession(id);
      setNotice('Session fermée : cet appareil devra se reconnecter.');
      await load();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(null);
    }
  }

  async function closeOthers(): Promise<void> {
    setBusy('others');
    try {
      const closed = await closeOtherSessions();
      setAsking(false);
      setNotice(closedText(closed.sessions, closed.trustedDevices));
      await load();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(null);
    }
  }

  const now = new Date();
  const others = sessions?.filter((session) => !session.current).length ?? 0;
  return (
    <Panel title="Sessions ouvertes" eyebrow="Tes appareils">
      <PanelSection>
        {sessions === null && error === null ? <p className={MUTED}>Chargement…</p> : null}
        {sessions === null ? null : (
          <ul className={ROWS} aria-label="Sessions ouvertes">
            {sessions.map((session, index) => (
              <li
                key={session.id}
                className="nv-enter flex items-center gap-4 py-3 first:pt-0"
                style={{ '--nv-i': index + 1 }}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                    {session.device}
                    {session.current ? (
                      <span className="nv-status nv-status--human">
                        <span className="nv-status__dot" />
                        Cet appareil
                      </span>
                    ) : null}
                  </span>
                  <span className={MUTED}>
                    {session.network === null ? 'Réseau inconnu' : `Réseau ${session.network}`} · active{' '}
                    {ago(session.lastActiveAt, now)}
                  </span>
                </div>
                {session.current ? null : (
                  <button
                    type="button"
                    className="nv-btn nv-btn--plain nv-btn--sm shrink-0"
                    disabled={busy !== null}
                    aria-label={`Fermer la session ${session.device}`}
                    onClick={() => void close(session.id)}
                  >
                    {busy === session.id ? 'Fermeture…' : 'Fermer'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {asking ? (
          <div className="nv-glass flex flex-col gap-3 rounded-[var(--nv-radius-md)] p-3" role="group">
            <p className="text-sm">
              Les {String(others)} autres sessions seront fermées, et tes appareils de confiance oubliés :
              chacun redemandera ton mot de passe et ton code.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="nv-btn nv-btn--neon nv-btn--sm"
                disabled={busy !== null}
                onClick={() => void closeOthers()}
              >
                {busy === 'others' ? 'Fermeture…' : 'Fermer les autres'}
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                disabled={busy !== null}
                onClick={() => {
                  setAsking(false);
                }}
              >
                Annuler
              </button>
            </div>
          </div>
        ) : others > 0 ? (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm self-start"
            disabled={busy !== null}
            onClick={() => {
              setAsking(true);
              setNotice(null);
            }}
          >
            Fermer toutes les autres
          </button>
        ) : null}
        <Outcome error={error} notice={notice} />
      </PanelSection>
    </Panel>
  );
}

function BackupCodesPanel(): JSX.Element {
  const [step, setStep] = useState<'idle' | 'confirm' | 'shown'>('idle');
  const [codes, setCodes] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordId = useId();
  const password = useRef<HTMLInputElement>(null);
  const code = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'confirm') password.current?.focus();
  }, [step]);

  async function generate(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const given = password.current?.value ?? '';
    const typed = code.current?.value ?? '';
    if (given === '') return;
    if (typed.trim() === '') {
      code.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setCodes(await generateBackupCodes(given, typed));
      setStep('shown');
    } catch (failure) {
      if (code.current !== null) code.current.value = '';
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Codes de secours" eyebrow="Sans ton téléphone">
      <PanelSection>
        {step === 'shown' ? (
          <>
            <p className="text-sm">
              Voici tes dix nouveaux codes. Les anciens ne marchent plus. Ils ne seront plus affichés :
              garde-les dans ton gestionnaire de mots de passe ou sur papier, jamais en photo.
            </p>
            <BackupCodesList codes={codes} />
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm self-start"
              onClick={() => {
                setStep('idle');
                setCodes([]);
              }}
            >
              Je les ai mis en lieu sûr
            </button>
          </>
        ) : (
          <>
            <p className={MUTED}>
              Chacun remplace une fois le code de ton application. Tu les as perdus, ou il t’en reste peu ?
              Crée-en dix nouveaux : les anciens cesseront de marcher.
            </p>
            {step === 'idle' ? (
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm self-start"
                onClick={() => {
                  setStep('confirm');
                }}
              >
                Créer de nouveaux codes
              </button>
            ) : (
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => void generate(event)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && !busy) setStep('idle');
                }}
              >
                <label className="nv-field min-w-[12rem] flex-1" htmlFor={passwordId}>
                  <span className="nv-field__label">Mot de passe</span>
                  <input
                    ref={password}
                    id={passwordId}
                    className="nv-field__control"
                    type="password"
                    autoComplete="current-password"
                    aria-invalid={error !== null}
                    readOnly={busy}
                  />
                </label>
                <CodeInput ref={code} disabled={busy} invalid={error !== null} />
                <div className="flex gap-2">
                  <button type="submit" className="nv-btn nv-btn--neon nv-btn--sm" disabled={busy}>
                    {busy ? 'Création…' : 'Créer les codes'}
                  </button>
                  <button
                    type="button"
                    className="nv-btn nv-btn--plain nv-btn--sm"
                    disabled={busy}
                    onClick={() => {
                      setStep('idle');
                      setError(null);
                    }}
                  >
                    Annuler
                  </button>
                </div>
              </form>
            )}
            {error === null ? null : (
              <p role="alert" className="text-sm text-[var(--nv-warning)]">
                {error}
              </p>
            )}
          </>
        )}
      </PanelSection>
    </Panel>
  );
}

function AccountsPanel({ ownerId }: { ownerId: string }): JSX.Element {
  const [accounts, setAccounts] = useState<readonly AccountSecurity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccounts(await fetchAccounts());
      setError(null);
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function closeAll(account: AccountSecurity): Promise<void> {
    setBusy(account.userId);
    setNotice(null);
    try {
      const closed = await closeAccountSessions(account.userId);
      setConfirming(null);
      setNotice(`${account.name} : ${closedText(closed.sessions, closed.trustedDevices)}`);
      await load();
    } catch (failure) {
      if (failure instanceof SecurityError && failure.kind === 'reauth_required')
        setConfirming(account.userId);
      else setError(messageOf(failure));
    } finally {
      setBusy(null);
    }
  }

  const now = new Date();
  return (
    <Panel title="Comptes de l’agence" eyebrow="Propriétaire">
      <PanelSection>
        {accounts === null && error === null ? <p className={MUTED}>Chargement…</p> : null}
        {accounts === null ? null : (
          <ul className={ROWS} aria-label="Comptes de l’agence">
            {accounts.map((account, index) => (
              <li
                key={account.userId}
                className="nv-enter flex flex-col gap-3 py-3 first:pt-0"
                style={{ '--nv-i': index + 1 }}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-baseline gap-x-2 font-semibold">
                      {account.name}
                      <span className="text-sm font-normal text-[var(--nv-ink-muted)]">
                        {ROLE_LABELS[account.role]}
                      </span>
                    </span>
                    <span className={MUTED}>
                      {sessionsText(account.sessions)}
                      {account.lastActiveAt === null ? '' : ` · active ${ago(account.lastActiveAt, now)}`}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span
                      className={`nv-status ${account.secondFactor ? 'nv-status--sent' : 'nv-status--awaiting-approval'}`}
                    >
                      <span className="nv-status__dot" />
                      {account.secondFactor
                        ? 'Code à 6 chiffres actif'
                        : 'Code à 6 chiffres pas encore activé'}
                    </span>
                    {account.userId === ownerId || account.sessions === 0 ? null : (
                      <button
                        type="button"
                        className="nv-btn nv-btn--plain nv-btn--sm"
                        disabled={busy !== null}
                        aria-label={`Fermer toutes les sessions de ${account.name}`}
                        onClick={() => void closeAll(account)}
                      >
                        {busy === account.userId ? 'Fermeture…' : 'Fermer ses sessions'}
                      </button>
                    )}
                  </div>
                </div>
                {confirming === account.userId ? (
                  <PasswordPrompt
                    lead={`Pour fermer toutes les sessions de ${account.name}, confirme ton mot de passe et ton code.`}
                    onConfirmed={() => void closeAll(account)}
                    onCancel={() => {
                      setConfirming(null);
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <Outcome error={error} notice={notice} />
      </PanelSection>
    </Panel>
  );
}
