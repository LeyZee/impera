import { ExtensionLinkLabelSchema, type ExtensionLink, type ExtensionLinkCreated } from '@impera/contracts';
import { useCallback, useEffect, useId, useRef, useState, type JSX, type SyntheticEvent } from 'react';

import {
  createExtensionLink,
  ExtensionLinkError,
  fetchExtensionLinks,
  LINK_FAILURES,
  revokeExtensionLink,
} from './extension-links';
import { ago, dayText } from './view';

import { CopyButton } from '@/auth/BackupCodesList';
import { Panel, PanelSection } from '@/shell/layout';

/** Three browsers at most (`EXTENSION_LINKS_LIVE_MAX` on the server). */
export const EXTENSION_LINKS_MAX = 3;

const MUTED = 'text-sm text-[var(--nv-ink-muted)]';

const failureOf = (error: unknown): string =>
  error instanceof ExtensionLinkError ? error.message : LINK_FAILURES.failed;

/** « Chrome du bureau », guessed from the browser this page runs in; the person changes it. */
export function suggestedLabel(userAgent: string): string {
  if (userAgent.includes('Edg/')) return 'Edge';
  if (userAgent.includes('Firefox/')) return 'Firefox';
  if (userAgent.includes('Chrome/')) return 'Chrome';
  return 'Mon navigateur';
}

/** Why the label cannot be sent as it is; `null` when it can. */
export function labelProblem(label: string): string | null {
  if (label.trim() === '') return 'Donne un nom à ce navigateur.';
  return ExtensionLinkLabelSchema.safeParse(label).success ? null : '40 caractères au plus.';
}

/**
 * « Relier l’extension » (VEI-02, ADR 0066 § 7): the browsers where the person watches Instagram for the agency's
 * morning ideas. Each link gives one code, shown once, that the person pastes in the extension; unlinking a browser
 * stops what it sends. Shown to the owner and the managers only: the watch is theirs.
 */
export function ExtensionLinksPanel(): JSX.Element {
  const [links, setLinks] = useState<readonly ExtensionLink[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<'idle' | 'naming'>('idle');
  const [label, setLabel] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<ExtensionLinkCreated | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const labelId = useId();
  const labelInput = useRef<HTMLInputElement>(null);
  const now = new Date();

  const load = useCallback(async (): Promise<void> => {
    try {
      setLinks(await fetchExtensionLinks());
      setLoadError(null);
    } catch (failure) {
      setLoadError(failureOf(failure));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (step === 'naming') labelInput.current?.select();
  }, [step]);

  async function link(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const wrong = labelProblem(label);
    if (wrong !== null) {
      setProblem(wrong);
      labelInput.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const made = await createExtensionLink(label.trim());
      setCreated(made);
      setStep('idle');
      await load();
    } catch (failure) {
      setError(failureOf(failure));
    } finally {
      setBusy(false);
    }
  }

  async function unlink(target: ExtensionLink): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await revokeExtensionLink(target.id);
      setConfirming(null);
      if (created?.id === target.id) setCreated(null);
      setNotice(`${target.label} est délié : son extension n’envoie plus rien.`);
      await load();
    } catch (failure) {
      setError(failureOf(failure));
    } finally {
      setBusy(false);
    }
  }

  const full = links !== null && links.length >= EXTENSION_LINKS_MAX;

  return (
    <Panel title="Relier l’extension" eyebrow="Veille Instagram">
      <PanelSection>
        <p className={MUTED}>
          Pendant que tu regardes Instagram, l’extension Impera relève les posts qui marchent pour les idées
          du matin. Relie chaque navigateur où elle est installée, {String(EXTENSION_LINKS_MAX)} au plus.
        </p>
        {loadError !== null ? (
          <p className="text-sm text-[var(--nv-warning)]" role="alert">
            {loadError}
          </p>
        ) : links === null ? (
          <p className={MUTED}>Chargement…</p>
        ) : links.length === 0 ? (
          <p className="text-sm">Aucun navigateur relié.</p>
        ) : (
          <ul
            className="mt-2 flex flex-col divide-y divide-[var(--nv-hairline)]"
            aria-label="Navigateurs reliés"
          >
            {links.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.label}</p>
                  <p className="text-xs text-[var(--nv-ink-muted)]">
                    Relié le {dayText(item.createdAt)} ·{' '}
                    {item.lastUsedAt === null
                      ? 'rien reçu encore'
                      : `dernier envoi ${ago(item.lastUsedAt, now)}`}
                  </p>
                </div>
                {confirming === item.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">Délier ce navigateur&nbsp;?</span>
                    <button
                      type="button"
                      className="nv-btn nv-btn--soft nv-btn--destructive nv-btn--sm"
                      disabled={busy}
                      onClick={() => void unlink(item)}
                    >
                      {busy ? 'Déliaison…' : 'Délier'}
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
                  </div>
                ) : (
                  <button
                    type="button"
                    className="nv-btn nv-btn--plain nv-btn--sm"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(item.id);
                      setError(null);
                      setNotice(null);
                    }}
                  >
                    Délier
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      {created === null ? null : (
        <CreatedCode
          created={created}
          onDone={() => {
            setCreated(null);
          }}
        />
      )}

      {links === null || loadError !== null ? null : (
        <PanelSection>
          {step === 'naming' ? (
            <form
              className="flex flex-col gap-2"
              noValidate
              onSubmit={(event) => void link(event)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !busy) setStep('idle');
              }}
            >
              <div className="flex flex-wrap items-end gap-3">
                <label className="nv-field min-w-[12rem] flex-1" htmlFor={labelId}>
                  <span className="nv-field__label">Nom de ce navigateur</span>
                  <input
                    ref={labelInput}
                    id={labelId}
                    className="nv-field__control"
                    value={label}
                    maxLength={60}
                    autoComplete="off"
                    aria-invalid={problem !== null}
                    aria-describedby={`${labelId}-hint`}
                    readOnly={busy}
                    onChange={(event) => {
                      setLabel(event.target.value);
                      setProblem(null);
                    }}
                  />
                </label>
                <div className="flex gap-2">
                  <button type="submit" className="nv-btn nv-btn--neon nv-btn--sm" disabled={busy}>
                    {busy ? 'Liaison…' : 'Relier'}
                  </button>
                  <button
                    type="button"
                    className="nv-btn nv-btn--plain nv-btn--sm"
                    disabled={busy}
                    onClick={() => {
                      setStep('idle');
                      setProblem(null);
                    }}
                  >
                    Annuler
                  </button>
                </div>
              </div>
              <p
                id={`${labelId}-hint`}
                className={
                  problem === null ? 'text-xs text-[var(--nv-ink-muted)]' : 'text-xs text-[var(--nv-warning)]'
                }
              >
                {problem ?? 'Un navigateur déjà relié sous ce nom reçoit un nouveau code.'}
              </p>
            </form>
          ) : full ? (
            <p className={MUTED}>
              {String(EXTENSION_LINKS_MAX)} navigateurs sont reliés&nbsp;: délies-en un pour en relier un
              autre.
            </p>
          ) : (
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm self-start"
              onClick={() => {
                setLabel(suggestedLabel(navigator.userAgent));
                setStep('naming');
                setError(null);
                setNotice(null);
              }}
            >
              Relier un navigateur
            </button>
          )}
          <p className="text-sm empty:hidden" aria-live="polite">
            {error === null ? notice : <span className="text-[var(--nv-warning)]">{error}</span>}
          </p>
        </PanelSection>
      )}
    </Panel>
  );
}

/** The code of the link just made, shown this once: the server keeps only its hash. */
function CreatedCode({
  created,
  onDone,
}: {
  created: ExtensionLinkCreated;
  onDone: () => void;
}): JSX.Element {
  const shown = useRef<HTMLElement>(null);
  return (
    <PanelSection label={`Code pour ${created.label}`}>
      <p className="text-sm">
        Ouvre l’extension Impera dans ce navigateur, choisis «&nbsp;Relier&nbsp;» et colle ce code. Il ne sera
        plus affiché&nbsp;: perdu, relie ce navigateur de nouveau.
      </p>
      <code
        ref={shown}
        className="nv-glass block rounded-[var(--nv-radius-md)] px-4 py-3 font-mono text-sm break-all select-all"
        aria-label="Code de liaison"
      >
        {created.token}
      </code>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={created.token} label="Copier le code" shown={shown} />
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" onClick={onDone}>
          C’est collé
        </button>
      </div>
    </PanelSection>
  );
}
