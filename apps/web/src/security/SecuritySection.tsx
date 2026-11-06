import type { AccountSecurity, OpenSession, Passkey } from '@impera/contracts';
import { useCallback, useEffect, useId, useRef, useState, type JSX, type SyntheticEvent } from 'react';

import { ExtensionLinksPanel } from './ExtensionLinksPanel';
import {
  closeAccountSessions,
  closeOtherSessions,
  closeSession,
  fetchAccounts,
  fetchOwnPasskeys,
  fetchSessions,
  generateBackupCodes,
  removeAccountPasskeys,
  removePasskey,
  SECURITY_ERROR_MESSAGES,
  SecurityError,
} from './api';
import {
  ago,
  closedText,
  dayText,
  passkeysText,
  ROLE_LABELS,
  sessionGroups,
  sessionsText,
  type SessionGroup,
} from './view';

import { BackupCodesList } from '@/auth/BackupCodesList';
import { CodeInput } from '@/auth/CodeInput';
import { addPasskey, canUsePasskeys, gestureName } from '@/auth/passkeys';
import { PasswordPrompt } from '@/settings/services/PasswordPrompt';
import { Panel, PanelSection } from '@/shell/layout';

const messageOf = (error: unknown): string =>
  error instanceof SecurityError ? error.message : SECURITY_ERROR_MESSAGES.unavailable;

const MUTED = 'text-sm text-[var(--nv-ink-muted)]';
const ROWS = 'flex flex-col divide-y divide-[var(--nv-hairline)]';

/**
 * Réglages › Sécurité (ADR 0046 § 7, SEC-04): one's open sessions and backup codes; for the owner, each account's second
 * factor and keys (`ownerId` given). One's passkeys sit next to the sessions (ADR 0053 § 5). A session shows its device, its network and when it was last used: never a full address, never a country
 * (no geographic base: Charles's choice of 02/11). The owner and the managers also link here the browsers where they
 * watch Instagram (`extensionLinks`, VEI-02): the watch is theirs.
 */
export function SecuritySection({
  ownerId,
  extensionLinks = false,
}: {
  ownerId?: string;
  extensionLinks?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <SessionsPanel />
      <PasskeysPanel />
      <BackupCodesPanel />
      {ownerId === undefined ? null : <AccountsPanel ownerId={ownerId} />}
      {extensionLinks ? <ExtensionLinksPanel /> : null}
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

/** The other devices shown before « Voir les N autres »: the screen keeps room for the keys and the codes. */
const SHOWN_GROUPS = 3;

function SessionsPanel(): JSX.Element {
  const [sessions, setSessions] = useState<readonly OpenSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

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

  async function close(group: SessionGroup): Promise<void> {
    setBusy(group.key);
    setNotice(null);
    setError(null);
    try {
      for (const id of group.ids) await closeSession(id);
      setNotice(
        group.ids.length === 1
          ? 'Session fermée : cet appareil devra se reconnecter.'
          : `${sessionsText(group.ids.length).replace(' ouvertes', ' fermées')} : cet appareil devra se reconnecter.`,
      );
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      // What was closed before a refusal is closed all the same: the list says so.
      await load();
      setBusy(null);
    }
  }

  async function closeOthers(): Promise<void> {
    setBusy('others');
    setError(null);
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
  const groups = sessionGroups(sessions ?? []);
  const currentGroups = groups.filter((group) => group.current);
  const otherGroups = groups.filter((group) => !group.current);
  // Folding away a single line saves nothing: the list folds from two hidden lines on.
  const canFold = otherGroups.length > SHOWN_GROUPS + 1;
  const hidden = showAll || !canFold ? 0 : otherGroups.length - SHOWN_GROUPS;
  const shown = [...currentGroups, ...otherGroups.slice(0, otherGroups.length - hidden)];
  return (
    <Panel title="Sessions ouvertes" eyebrow="Tes appareils">
      <PanelSection>
        {/* What matters first: this device, and closing the others, above a list that can be long. */}
        {asking ? (
          <div
            className="nv-glass flex flex-col gap-3 rounded-[var(--nv-radius-md)] p-3"
            role="group"
            aria-label="Confirmer la fermeture"
          >
            <p className="text-sm">
              Les {String(others)} autres sessions seront fermées, et tes autres appareils de confiance
              oubliés : chacun redemandera ton mot de passe et ton code.
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={MUTED}>
              {others === 1 ? '1 autre session' : `${String(others)} autres sessions`}
            </span>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              disabled={busy !== null}
              onClick={() => {
                setAsking(true);
                setNotice(null);
              }}
            >
              Fermer toutes les autres
            </button>
          </div>
        ) : null}
        <Outcome error={error} notice={notice} />
        {sessions === null && error === null ? <p className={MUTED}>Chargement…</p> : null}
        {sessions === null ? null : (
          <ul className={ROWS} aria-label="Sessions ouvertes">
            {shown.map((group, index) => (
              <li
                key={group.key}
                className="nv-enter flex items-center gap-4 py-3 first:pt-0"
                style={{ '--nv-i': index + 1 }}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                    {group.device}
                    {group.current ? (
                      <span className="nv-status nv-status--human">
                        <span className="nv-status__dot" />
                        Cet appareil
                      </span>
                    ) : null}
                  </span>
                  <span className={MUTED}>
                    {group.network === null ? 'Réseau inconnu' : `Réseau ${group.network}`}
                    {group.ids.length > 1 ? ` · ${String(group.ids.length)}\u00a0sessions` : ''} ·{' '}
                    {/* The device in use is active now: the server writes the activity only now and then (PRO-18). */}
                    {group.current ? 'actif maintenant' : `dernière activité ${ago(group.lastActiveAt, now)}`}
                  </span>
                </div>
                {group.current ? null : (
                  <button
                    type="button"
                    className="nv-btn nv-btn--plain nv-btn--sm shrink-0"
                    disabled={busy !== null}
                    aria-label={
                      group.ids.length === 1
                        ? `Fermer la session ${group.device}`
                        : `Fermer les ${String(group.ids.length)} sessions ${group.device}`
                    }
                    onClick={() => void close(group)}
                  >
                    {busy === group.key ? 'Fermeture…' : 'Fermer'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canFold ? (
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm self-start"
            aria-expanded={showAll}
            onClick={() => {
              setShowAll((value) => !value);
            }}
          >
            {showAll ? 'Voir moins' : `Voir les ${String(hidden)} autres`}
          </button>
        ) : null}
      </PanelSection>
    </Panel>
  );
}

const ADD_REFUSALS: Readonly<Record<'refused' | 'session_expired' | 'unavailable', string>> = {
  refused: 'Cet appareil n’a pas demandé ton visage, ton doigt ou son code : la clé n’a pas été ajoutée.',
  session_expired: SECURITY_ERROR_MESSAGES.session_expired,
  unavailable: SECURITY_ERROR_MESSAGES.unavailable,
};

/**
 * Clés d'accès (ADR 0053 § 5): one's keys, each by the device it was added from, its keychain, the day it was added
 * and its last use; a key is added on this device after the password and the code (never a gesture), and removed
 * after a confirmation. Closing sessions leaves the keys: two separate acts, side by side.
 */
function PasskeysPanel(): JSX.Element {
  const [keys, setKeys] = useState<readonly Passkey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ readonly removing: string } | 'adding' | null>(null);
  const [canAdd] = useState(canUsePasskeys);
  const gesture = gestureName();

  const load = useCallback(async () => {
    try {
      setKeys(await fetchOwnPasskeys());
      setError(null);
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(): Promise<void> {
    setBusy('add');
    setNotice(null);
    setError(null);
    const result = await addPasskey().catch(() => ({ kind: 'unavailable' as const }));
    setBusy(null);
    switch (result.kind) {
      case 'ok':
        setNotice(`Clé ajoutée : ${result.passkey.device}. Tu te connecteras d’un geste sur cet appareil.`);
        await load();
        return;
      case 'reauth_required':
        setConfirming('adding');
        return;
      case 'already':
        setNotice('Cet appareil a déjà une clé de ton compte.');
        return;
      case 'cancelled':
        return;
      case 'refused':
      case 'session_expired':
      case 'unavailable':
        setError(ADD_REFUSALS[result.kind]);
    }
  }

  async function remove(key: Passkey): Promise<void> {
    setBusy(key.id);
    setNotice(null);
    setError(null);
    try {
      await removePasskey(key.id);
      setConfirming(null);
      setNotice(`Clé retirée : ${key.device} redemandera ton mot de passe et ton code.`);
      await load();
    } catch (failure) {
      if (failure instanceof SecurityError && failure.kind === 'reauth_required') {
        setConfirming({ removing: key.id });
      } else setError(messageOf(failure));
    } finally {
      setBusy(null);
    }
  }

  const now = new Date();
  return (
    <Panel title="Clés d’accès" eyebrow="Face ID, empreinte">
      <PanelSection>
        {keys === null && error === null ? <p className={MUTED}>Chargement…</p> : null}
        {keys === null ? null : keys.length === 0 ? (
          <p className={MUTED}>
            Aucune clé. Ajoute {gesture} pour te connecter d’un geste, sans mot de passe ni code&nbsp;; ton
            code reste la porte de secours.
          </p>
        ) : (
          <ul className={ROWS} aria-label="Clés d’accès">
            {keys.map((key, index) => (
              <li
                key={key.id}
                className="nv-enter flex flex-col gap-3 py-3 first:pt-0"
                style={{ '--nv-i': index + 1 }}
              >
                <div className="flex items-center gap-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-semibold">{key.device}</span>
                    <span className={MUTED}>
                      {key.keychain === null ? '' : `${key.keychain} · `}ajoutée le {dayText(key.createdAt)} ·{' '}
                      {key.lastUsedAt === null ? 'jamais utilisée' : `utilisée ${ago(key.lastUsedAt, now)}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="nv-btn nv-btn--plain nv-btn--sm shrink-0"
                    disabled={busy !== null}
                    aria-label={`Retirer la clé ${key.device}`}
                    onClick={() => void remove(key)}
                  >
                    {busy === key.id ? 'Retrait…' : 'Retirer'}
                  </button>
                </div>
                {confirming !== null && confirming !== 'adding' && confirming.removing === key.id ? (
                  <PasswordPrompt
                    passkey={{ excluding: key.id }}
                    lead="Pour retirer cette clé, confirme ton mot de passe et ton code, ou un geste sur une autre clé."
                    onConfirmed={() => void remove(key)}
                    onCancel={() => {
                      setConfirming(null);
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {confirming === 'adding' ? (
          <PasswordPrompt
            passkey={false}
            lead={`Pour ajouter ${gesture}, confirme d’abord ton mot de passe et ton code.`}
            onConfirmed={() => {
              setConfirming(null);
              // A fresh tap: Safari opens Face ID only right after a gesture of the person.
              setNotice(`C’est confirmé. Touche « Ajouter ${gesture} » pour créer la clé.`);
            }}
            onCancel={() => {
              setConfirming(null);
            }}
          />
        ) : canAdd ? (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm self-start"
            disabled={busy !== null}
            onClick={() => void add()}
          >
            {busy === 'add' ? 'Ajout…' : `Ajouter ${gesture}`}
          </button>
        ) : (
          <p className={MUTED}>
            Ce navigateur ne sait pas créer de clé d’accès&nbsp;: ajoute-la depuis ton téléphone.
          </p>
        )}
        <p className="text-sm text-[var(--nv-ink-faint)]">
          Fermer des sessions ne retire pas les clés&nbsp;: retire-les ici.
        </p>
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
              Chacun remplace une fois le code de ton application. Tu les as perdus, ou il t’en reste
              peu&nbsp;? Crée-en dix nouveaux&nbsp;: les anciens cesseront de marcher.
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

/** The owner's two acts on an account: close its sessions, or remove its keys. */
type Act = 'close' | 'keys';

function AccountsPanel({ ownerId }: { ownerId: string }): JSX.Element {
  const [accounts, setAccounts] = useState<readonly AccountSecurity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ readonly userId: string; readonly act: Act } | null>(null);
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

  /** Closes every session of an account, or removes every key of it; both are sensitive actions. */
  async function run(account: AccountSecurity, act: Act): Promise<void> {
    setBusy(`${act}:${account.userId}`);
    setNotice(null);
    setError(null);
    try {
      if (act === 'close') {
        const closed = await closeAccountSessions(account.userId);
        setNotice(`${account.name} : ${closedText(closed.sessions, closed.trustedDevices)}`);
      } else {
        const removed = await removeAccountPasskeys(account.userId);
        setNotice(
          `${account.name} : ${passkeysText(removed).replace('Aucune', 'aucune')} retirée${removed > 1 ? 's' : ''}. Ses sessions restent ouvertes.`,
        );
      }
      setConfirming(null);
      await load();
    } catch (failure) {
      if (failure instanceof SecurityError && failure.kind === 'reauth_required') {
        setConfirming({ userId: account.userId, act });
      } else setError(messageOf(failure));
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
                      {account.userId === ownerId
                        ? ' · actif maintenant'
                        : account.lastActiveAt === null
                          ? ''
                          : ` · dernière activité ${ago(account.lastActiveAt, now)}`}
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
                    <span className={MUTED}>{passkeysText(account.passkeys)}</span>
                    {account.userId === ownerId || account.sessions === 0 ? null : (
                      <button
                        type="button"
                        className="nv-btn nv-btn--plain nv-btn--sm"
                        disabled={busy !== null}
                        aria-label={`Fermer toutes les sessions de ${account.name}`}
                        onClick={() => void run(account, 'close')}
                      >
                        {busy === `close:${account.userId}` ? 'Fermeture…' : 'Fermer ses sessions'}
                      </button>
                    )}
                    {account.userId === ownerId || account.passkeys === 0 ? null : (
                      <button
                        type="button"
                        className="nv-btn nv-btn--plain nv-btn--sm"
                        disabled={busy !== null}
                        aria-label={`Retirer toutes les clés d’accès de ${account.name}`}
                        onClick={() => void run(account, 'keys')}
                      >
                        {busy === `keys:${account.userId}` ? 'Retrait…' : 'Retirer ses clés'}
                      </button>
                    )}
                  </div>
                </div>
                {confirming?.userId === account.userId ? (
                  <PasswordPrompt
                    lead={
                      confirming.act === 'close'
                        ? `Pour fermer toutes les sessions de ${account.name}, confirme ton mot de passe et ton code.`
                        : `Pour retirer toutes les clés d’accès de ${account.name}, confirme ton mot de passe et ton code.`
                    }
                    onConfirmed={() => void run(account, confirming.act)}
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
