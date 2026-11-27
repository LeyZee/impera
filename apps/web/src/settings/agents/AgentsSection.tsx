import {
  McpGrantLabelSchema,
  type CreatorId,
  type CreatorSummary,
  type McpCapability,
  type McpGrant,
  type McpGrantCreated,
} from '@impera/contracts';
import { useCallback, useEffect, useId, useRef, useState, type JSX, type SyntheticEvent } from 'react';

import { createGrant, fetchGrants, GRANT_FAILURES, GrantError, revokeGrant } from './api';
import {
  CAPABILITY_CHOICES,
  CAPABILITY_GROUPS,
  capabilityLabel,
  DURATIONS,
  PRESETS,
  type Duration,
  type Preset,
} from './capabilities';
import './connected-agents.css';

import { CopyButton } from '@/auth/BackupCodesList';
import { useCreators } from '@/creators/api';
import { SwitchRow } from '@/creators/persona/fields';
import '@/creators/persona/persona.css';
import '@/scheduling/exchanges.css';
import { ago, dayText } from '@/security/view';
import { PasswordPrompt } from '@/settings/services/PasswordPrompt';
import { Panel, PanelSection } from '@/shell/layout';

const DAY_MS = 86_400_000;
/** An access that ends within a week says so in amber. */
const SOON_DAYS = 7;

const failureOf = (error: unknown): string =>
  error instanceof GrantError ? error.message : GRANT_FAILURES.failed;

/** Where an agent reaches the MCP server: this page's own address, as the CRM is served (the PC today, the VPS later). */
export function serverUrl(origin: string): string {
  return `${origin}/v1/mcp`;
}

/** The line that connects Claude Code to Impera with this token. */
export function claudeCodeCommand(url: string, token: string): string {
  return `claude mcp add --transport http impera ${url} --header "Authorization: Bearer ${token}"`;
}

/** Why the name cannot be sent as it is; `null` when it can. */
export function labelProblem(label: string): string | null {
  if (label.trim() === '') return 'Donne un nom à cet agent.';
  return McpGrantLabelSchema.safeParse(label).success ? null : '40 caractères au plus.';
}

/** An access's state, as its line says it. */
export function grantState(grant: McpGrant, now: Date): 'live' | 'revoked' | 'expired' {
  if (grant.revokedAt !== null) return 'revoked';
  return Date.parse(grant.expiresAt) <= now.getTime() ? 'expired' : 'live';
}

/** Whole days left before an access ends, today not counted; 0 on its last day. */
export function daysLeft(grant: McpGrant, now: Date): number {
  return Math.max(0, Math.floor((Date.parse(grant.expiresAt) - now.getTime()) / DAY_MS));
}

/** The dot of a live access: green once it called within a day, grey while it never called or keeps quiet. */
function calledToday(grant: McpGrant, now: Date): boolean {
  return grant.lastUsedAt !== null && now.getTime() - Date.parse(grant.lastUsedAt) < DAY_MS;
}

function scopeText(creatorId: CreatorId | null, creators: readonly CreatorSummary[]): string {
  if (creatorId === null) return 'Toute l’agence';
  return creators.find((one) => one.id === creatorId)?.displayName ?? 'Une créatrice';
}

/** « Ventes » et « Chiffres et état » : the reads in a sentence, in the screen's words. */
export function readsSentence(capabilities: readonly McpCapability[]): string {
  const names = capabilities.map((one) => `« ${capabilityLabel(one)} »`);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1] ?? ''}`;
}

/**
 * Réglages › Agents connectés (ADR 0026 § 3, ADR 0105 § 1, glossaire « Accès d'agent »): the owner gives an agent of
 * his (Claude Code on the PC, his accounting software) a token of its own, for the reads he ticks, never one by
 * default, 90 days at most. A ready set ticks the usual reads in one tap. The token is shown once; creating it asks
 * for the password and a code again. Revoking is for good. The agent only reads: nothing here opens a gesture.
 */
export function AgentsSection(): JSX.Element {
  const creators = useCreators().data ?? [];
  const [grants, setGrants] = useState<readonly McpGrant[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [preset, setPreset] = useState<Preset['id'] | null>(null);
  const [label, setLabel] = useState('');
  const [creatorId, setCreatorId] = useState<CreatorId | null>(null);
  const [ticked, setTicked] = useState<readonly McpCapability[]>([]);
  const [days, setDays] = useState<Duration>(30);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<McpGrantCreated | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const labelId = useId();
  const newCard = useRef<HTMLElement>(null);
  const now = new Date();

  const load = useCallback(async (): Promise<void> => {
    try {
      setGrants(await fetchGrants());
      setLoadError(null);
    } catch (failure) {
      setLoadError(failureOf(failure));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (creating) newCard.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [creating]);

  function reset(): void {
    setCreating(false);
    setPreset(null);
    setLabel('');
    setCreatorId(null);
    setTicked([]);
    setDays(30);
    setProblem(null);
    setReauth(false);
  }

  function choose(one: Preset): void {
    setPreset(one.id);
    setTicked(one.capabilities);
    if (label.trim() === '' || PRESETS.some((other) => other.label === label)) setLabel(one.label);
    setProblem(null);
  }

  function toggle(capability: McpCapability, on: boolean): void {
    setTicked((now) => (on ? [...now, capability] : now.filter((one) => one !== capability)));
    setPreset('custom');
    setProblem(null);
  }

  async function create(event?: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();
    if (event !== undefined && reauth) return;
    const wrong = labelProblem(label) ?? (ticked.length === 0 ? 'Coche au moins une lecture.' : null);
    if (wrong !== null) {
      setProblem(wrong);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const made = await createGrant({ label: label.trim(), creatorId, capabilities: [...ticked], days });
      setCreated(made);
      setFresh(made.id);
      reset();
      await load();
    } catch (failure) {
      // An access is a lasting credential: its creation asks for the password and a code again (ADR 0105 § 1).
      if (failure instanceof GrantError && failure.kind === 'reauth') setReauth(true);
      else setProblem(failureOf(failure));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(target: McpGrant): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await revokeGrant(target.id);
      setConfirming(null);
      if (created?.id === target.id) setCreated(null);
      setNotice(`${target.label} est révoqué : son jeton n’ouvre plus rien.`);
      await load();
    } catch (failure) {
      if (failure instanceof GrantError && failure.kind === 'reauth') setError(GRANT_FAILURES.reauth);
      else setError(failureOf(failure));
    } finally {
      setBusy(false);
    }
  }

  const live = grants?.filter((grant) => grantState(grant, now) === 'live') ?? [];
  const past = grants?.filter((grant) => grantState(grant, now) !== 'live') ?? [];
  const scopes: readonly { readonly id: CreatorId | null; readonly name: string }[] = [
    { id: null, name: 'Toute l’agence' },
    ...creators.map((one) => ({ id: one.id, name: one.displayName })),
  ];
  const warnings = CAPABILITY_CHOICES.filter(
    (choice) => choice.warning !== undefined && ticked.includes(choice.capability),
  );
  const ready = grants !== null && loadError === null;

  return (
    <div className="sv-page">
      {created === null ? null : (
        <CreatedToken
          created={created}
          onDone={() => {
            setCreated(null);
          }}
        />
      )}

      <Panel
        title="Tes agents"
        eyebrow="Serveur MCP"
        actions={
          ready && !creating ? (
            <button
              type="button"
              className="nv-btn nv-btn--neon nv-btn--sm"
              onClick={() => {
                setCreating(true);
                setError(null);
                setNotice(null);
              }}
            >
              Connecter un agent
            </button>
          ) : undefined
        }
      >
        <PanelSection>
          {loadError !== null ? (
            <p className="text-sm text-[var(--nv-warning)]" role="alert">
              {loadError}
            </p>
          ) : grants === null ? (
            <p className="text-sm text-[var(--nv-ink-muted)]">Chargement…</p>
          ) : live.length === 0 ? (
            <div className="nv-empty">
              <p className="nv-empty__title">Aucun agent branché</p>
              <p className="nv-empty__text">
                Un agent à toi lit tes chiffres avec un jeton à lui, sans rien pouvoir écrire.
              </p>
            </div>
          ) : (
            <ul className="mca-list" aria-label="Agents connectés">
              {live.map((grant) => {
                const left = daysLeft(grant, now);
                return (
                  <li key={grant.id} className={grant.id === fresh ? 'mca-row nv-enter' : 'mca-row'}>
                    <span
                      className={calledToday(grant, now) ? 'nv-dot nv-tone--ok' : 'nv-dot'}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="mca-row__name">{grant.label}</p>
                      <p className="mca-row__meta">
                        {scopeText(grant.creatorId, creators)} ·{' '}
                        {grant.lastUsedAt === null
                          ? 'aucun appel encore'
                          : `dernier appel ${ago(grant.lastUsedAt, now)}`}{' '}
                        ·{' '}
                        <span data-soon={left <= SOON_DAYS ? '' : undefined}>
                          {left === 0 ? 'expire aujourd’hui' : `expire dans ${String(left)}\u00a0j`}
                        </span>
                      </p>
                      <div className="nv-tags" aria-label="Ce qu’il lit">
                        {grant.capabilities.map((one) => (
                          <span key={one} className="nv-tag nv-tag--declared">
                            {capabilityLabel(one)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="mca-row__end">
                      {confirming === grant.id ? (
                        <>
                          <span className="text-sm">Révoquer pour de bon&nbsp;?</span>
                          <button
                            type="button"
                            className="nv-btn nv-btn--soft nv-btn--destructive nv-btn--sm"
                            disabled={busy}
                            onClick={() => void revoke(grant)}
                          >
                            {busy ? 'Révocation…' : 'Révoquer'}
                          </button>
                          <button
                            type="button"
                            className="nv-btn nv-btn--plain nv-btn--sm"
                            disabled={busy}
                            onClick={() => {
                              setConfirming(null);
                            }}
                          >
                            Garder
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="nv-btn nv-btn--plain nv-btn--sm"
                          disabled={busy}
                          onClick={() => {
                            setConfirming(grant.id);
                            setError(null);
                            setNotice(null);
                          }}
                        >
                          Révoquer
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-sm empty:hidden" aria-live="polite">
            {error === null ? notice : <span className="text-[var(--nv-warning)]">{error}</span>}
          </p>
        </PanelSection>
        {past.length === 0 ? null : (
          <PanelSection>
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm self-start"
              aria-expanded={showPast}
              onClick={() => {
                setShowPast((open) => !open);
              }}
            >
              {`${showPast ? 'Masquer' : 'Voir'} les révoqués ou expirés (${String(past.length)})`}
            </button>
            {showPast ? (
              <ul className="flex flex-col gap-1" aria-label="Agents révoqués ou expirés">
                {past.map((grant) => (
                  <li key={grant.id} className="text-sm text-[var(--nv-ink-muted)]">
                    {grant.label} ·{' '}
                    {grantState(grant, now) === 'revoked' && grant.revokedAt !== null
                      ? `révoqué le ${dayText(grant.revokedAt)}`
                      : `expiré le ${dayText(grant.expiresAt)}`}
                  </li>
                ))}
              </ul>
            ) : null}
          </PanelSection>
        )}
      </Panel>

      {creating ? (
        <section ref={newCard} className="nv-plate nv-panel" aria-labelledby={`${labelId}-title`}>
          <div className="nv-panel__head">
            <div className="min-w-0 flex-1">
              <p className="nv-eyebrow">Nouvel agent</p>
              <h2 id={`${labelId}-title`} className="nv-h2">
                Connecter un agent
              </h2>
            </div>
          </div>
          <form
            className="nv-panel__sec mca-steps"
            noValidate
            aria-label="Connecter un agent"
            onSubmit={(event) => void create(event)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) reset();
            }}
          >
            <div className="mca-step">
              <p className="mca-step__title">
                <span className="mca-step__num">1</span>Pour quoi faire&nbsp;?
              </p>
              <div className="sc-options" role="radiogroup" aria-label="Pour quoi faire">
                {PRESETS.map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    role="radio"
                    className="sc-option"
                    aria-checked={preset === one.id}
                    disabled={busy || reauth}
                    onClick={() => {
                      choose(one);
                    }}
                  >
                    <span className="sc-option__text">
                      <span className="sc-option__title">{one.title}</span>
                      <span className="sc-option__sub">{one.detail}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mca-step">
              <p className="mca-step__title">
                <span className="mca-step__num">2</span>Son nom et ce qu’il voit
              </p>
              <label className="nv-field" htmlFor={labelId}>
                <span className="nv-field__label">Nom de l’agent</span>
                <input
                  id={labelId}
                  className={reauth ? 'nv-field__control nv-field__control--readonly' : 'nv-field__control'}
                  value={label}
                  maxLength={60}
                  autoComplete="off"
                  placeholder="Clairière, Claude du PC…"
                  readOnly={busy || reauth}
                  onChange={(event) => {
                    setLabel(event.target.value);
                    setProblem(null);
                  }}
                />
              </label>
              <div className="ps-chips" role="radiogroup" aria-label="Ce qu’il voit">
                {scopes.map((choice) => (
                  <button
                    key={choice.id ?? 'agency'}
                    type="button"
                    role="radio"
                    className="nv-chip"
                    aria-checked={creatorId === choice.id}
                    disabled={busy || reauth}
                    onClick={() => {
                      setCreatorId(choice.id);
                    }}
                  >
                    {choice.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="mca-step">
              <p className="mca-step__title">
                <span className="mca-step__num">3</span>Ce qu’il peut lire
              </p>
              <div>
                {CAPABILITY_GROUPS.map((group) => (
                  <div key={group.title} className="mca-group">
                    <p className="nv-eyebrow mca-group__title">
                      {group.title}
                      {group.sensitive === true ? (
                        <span className="mca-group__sensitive">· sensible</span>
                      ) : null}
                    </p>
                    <div className="ps-switches">
                      {group.capabilities.map((capability) => {
                        const choice = CAPABILITY_CHOICES.find((one) => one.capability === capability);
                        if (choice === undefined) return null;
                        return (
                          <SwitchRow
                            key={capability}
                            label={choice.label}
                            detail={choice.detail}
                            checked={ticked.includes(capability)}
                            onChange={(value) => {
                              toggle(capability, value);
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mca-step">
              <p className="mca-step__title">
                <span className="mca-step__num">4</span>Combien de temps
              </p>
              <div className="ps-chips" role="radiogroup" aria-label="Durée du jeton">
                {DURATIONS.map((one) => (
                  <button
                    key={one}
                    type="button"
                    role="radio"
                    className="nv-chip"
                    aria-checked={days === one}
                    disabled={busy || reauth}
                    onClick={() => {
                      setDays(one);
                    }}
                  >
                    {`${String(one)} jours`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {ticked.length === 0 ? null : (
                <p className="nv-note" aria-label="Résumé">
                  {`${label.trim() === '' ? 'Cet agent' : label.trim()} lira ${readsSentence(ticked)}, pour ${
                    creatorId === null ? 'toute l’agence' : scopeText(creatorId, creators)
                  }, pendant ${String(days)} jours. Il ne pourra rien écrire.`}
                </p>
              )}
              {warnings.map((choice) => (
                <p key={choice.capability} className="nv-note nv-note--warn" role="note">
                  {choice.warning}
                </p>
              ))}
              {problem === null ? null : (
                <p className="text-sm text-[var(--nv-warning)]" role="alert">
                  {problem}
                </p>
              )}
              {reauth ? (
                <PasswordPrompt
                  lead="Pour créer ce jeton, confirme ton mot de passe et ton code."
                  onConfirmed={() => {
                    setReauth(false);
                    void create();
                  }}
                  onCancel={() => {
                    setReauth(false);
                  }}
                />
              ) : (
                <div className="flex gap-2">
                  <button type="submit" className="nv-btn nv-btn--neon" disabled={busy}>
                    {busy ? 'Création…' : 'Créer le jeton'}
                  </button>
                  <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={reset}>
                    Annuler
                  </button>
                </div>
              )}
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

/** One value of the new token's card, with its own copy button beside it. */
function CopyField({
  name,
  value,
  small = false,
}: {
  name: string;
  value: string;
  small?: boolean;
}): JSX.Element {
  const shown = useRef<HTMLElement>(null);
  return (
    <div className="mca-field">
      <span className="text-xs text-[var(--nv-ink-muted)]">{name}</span>
      <div className="mca-field__row">
        <code
          ref={shown}
          className={small ? 'nv-glass mca-code text-xs' : 'nv-glass mca-code'}
          aria-label={name}
        >
          {value}
        </code>
        <CopyButton text={value} label="Copier" shown={shown} />
      </div>
    </div>
  );
}

/**
 * The token of the access just made, shown this once, first on the page: where to paste it, in a software (the
 * server's address and the token) or in Claude Code (one line). Each value has its copy beside it.
 */
function CreatedToken({ created, onDone }: { created: McpGrantCreated; onDone: () => void }): JSX.Element {
  const card = useRef<HTMLElement>(null);
  const url = serverUrl(window.location.origin);
  const command = claudeCodeCommand(url, created.token);
  useEffect(() => {
    card.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);
  return (
    <section ref={card} className="nv-plate nv-panel nv-enter" aria-label={`Jeton de ${created.label}`}>
      <div className="nv-panel__head">
        <div className="min-w-0 flex-1">
          <p className="nv-eyebrow">Jeton créé</p>
          <h2 className="nv-h2">{`Branche ${created.label}`}</h2>
        </div>
      </div>
      <PanelSection>
        <p className="nv-note nv-note--warn" role="note">
          Montré une seule fois. Colle-le seulement dans ton agent, jamais dans un fil de discussion.
          Perdu&nbsp;: révoque cet agent et crée-en un autre.
        </p>
        <p className="nv-eyebrow">Dans un logiciel (Clairière…)</p>
        <CopyField name="Adresse du serveur" value={url} />
        <CopyField name="Jeton de l’agent" value={created.token} />
        <p className="nv-eyebrow">Ou dans Claude Code, sur ce PC</p>
        <CopyField name="Commande pour Claude Code" value={command} small />
      </PanelSection>
      <PanelSection>
        <div className="mca-foot">
          <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={onDone}>
            C’est fait, masquer le jeton
          </button>
        </div>
      </PanelSection>
    </section>
  );
}
