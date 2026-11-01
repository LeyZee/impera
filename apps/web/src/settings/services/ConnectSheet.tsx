import type { ProviderStatus, ProviderVoice } from '@nirvana/contracts';
import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { PasswordPrompt, SignInAgain } from './PasswordPrompt';
import { connectKey, ReauthRequired, saveSettings, showError, type ShownError } from './api';
import { GUIDES, type DashboardProvider } from './guide';
import { nextAfter, normalizeKey } from './view';

/** After the password, the key field is new and empty: the message says to paste the key again. */
const PASTE_AGAIN = 'Colle la clé à nouveau.';

type Phase =
  | { kind: 'edit'; error: ShownError | null }
  | { kind: 'busy' }
  /** The sign-in is too old for a key (ADR 0016): the password first, then the same key again. */
  | { kind: 'reauth'; key: string }
  | { kind: 'done'; status: ProviderStatus };

interface ConnectSheetProps {
  readonly provider: DashboardProvider;
  /** A key is already saved: the sheet replaces it, and the old one keeps working until the new one is verified. */
  readonly isReplace: boolean;
  readonly services: readonly ProviderStatus[];
  readonly onChanged: (status: ProviderStatus) => void;
  /** `null` closes the sheet; a provider opens its sheet next. */
  readonly onFinish: (next: DashboardProvider | null) => void;
}

const CHECK = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

type CopyState = 'idle' | 'copied' | 'failed';

const COPY_LABELS: Record<CopyState, string> = {
  idle: 'Copier',
  copied: 'Copié',
  failed: 'Copie impossible',
};

/** Writes `value` to the clipboard; `false` when the browser refuses (permission, no secure context). */
async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function CopyChip({ value }: { value: string }): JSX.Element {
  const [copy, setCopy] = useState<CopyState>('idle');
  useEffect(() => {
    if (copy === 'idle') return undefined;
    const timer = window.setTimeout(() => {
      setCopy('idle');
    }, 1400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copy]);
  return (
    <button
      type="button"
      className="sv-copy"
      data-copied={copy === 'copied'}
      data-copy={copy}
      onClick={() => {
        void copyText(value).then((isCopied) => {
          setCopy(isCopied ? 'copied' : 'failed');
        });
      }}
    >
      {value}
      <span aria-live="polite">{COPY_LABELS[copy]}</span>
    </button>
  );
}

/** One connection, two steps: create the key at the provider, paste it here. Verified before anything is kept. */
export function ConnectSheet({
  provider,
  isReplace,
  services,
  onChanged,
  onFinish,
}: ConnectSheetProps): JSX.Element {
  const guide = GUIDES[provider];
  const [hasOpenedConsole, setHasOpenedConsole] = useState(isReplace);
  const [isStepOneOpen, setIsStepOneOpen] = useState(!isReplace);
  const [phase, setPhase] = useState<Phase>({ kind: 'edit', error: null });
  const [voices, setVoices] = useState<readonly ProviderVoice[]>([]);
  const [voiceError, setVoiceError] = useState<ShownError | null>(null);
  /** Opening the console folds step one a beat later, once the new tab has taken focus. */
  const [isConsoleOpening, setIsConsoleOpening] = useState(false);
  const keyInput = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  useEffect(() => {
    if (hasOpenedConsole && phase.kind === 'edit') keyInput.current?.focus();
  }, [hasOpenedConsole, phase]);

  useEffect(() => {
    if (!isConsoleOpening) return undefined;
    const timer = window.setTimeout(() => {
      setHasOpenedConsole(true);
      setIsStepOneOpen(false);
      setIsConsoleOpening(false);
    }, 150);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isConsoleOpening]);

  /** The password being checked before the key is sent: the sheet must not close under it (the key would go anyway). */
  const [isReauthBusy, setIsReauthBusy] = useState(false);
  /** While the key is being verified, the sheet stays open: closing it would hide the answer. */
  const isBusy = phase.kind === 'busy' || (phase.kind === 'reauth' && isReauthBusy);
  const close = useCallback(() => {
    if (!isBusy) onFinish(null);
  }, [isBusy, onFinish]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [close]);

  /** `isRetry`: sent again after the password; the field the key was pasted in is gone by then. */
  async function submit(raw: string, isRetry = false): Promise<void> {
    const key = normalizeKey(raw);
    if (key === '') return;
    const failed = (shown: ShownError): Phase => ({
      kind: 'edit',
      error:
        isRetry && !shown.isSessionExpired ? { ...shown, message: `${shown.message} ${PASTE_AGAIN}` } : shown,
    });
    setPhase({ kind: 'busy' });
    try {
      const result = await connectKey(provider, key);
      if (!result.ok) {
        setPhase(failed({ message: result.refusal.message, isSessionExpired: false }));
        return;
      }
      if (keyInput.current !== null) keyInput.current.value = '';
      setVoices(result.status.voices);
      setPhase({ kind: 'done', status: result.status });
      onChanged(result.status);
    } catch (error) {
      setPhase(error instanceof ReauthRequired ? { kind: 'reauth', key } : failed(showError(error)));
    }
  }

  async function pickVoice(id: string): Promise<void> {
    const voice = voices.find((v) => v.id === id);
    if (voice === undefined) return;
    try {
      const status = await saveSettings(provider, { voice });
      setVoiceError(null);
      setPhase({ kind: 'done', status });
      onChanged(status);
    } catch (error) {
      setVoiceError(showError(error, 'La voix n’a pas été enregistrée.'));
    }
  }

  const closeLabel = (
    <button
      ref={closeButton}
      type="button"
      className="nv-close"
      aria-label="Fermer"
      disabled={isBusy}
      onClick={close}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="m4 4 8 8M12 4l-8 8" />
      </svg>
    </button>
  );

  if (phase.kind === 'done') {
    const after = nextAfter(services, provider);
    const status = phase.status;
    const showVoicePicker = provider === 'elevenlabs' && voices.length > 0;
    return (
      <Scrim onClose={close}>
        <header className="sv-sheet__head">
          <div className="sv-sheet__title" />
          {closeLabel}
        </header>
        <div className="sv-done">
          <svg viewBox="0 0 52 52" aria-hidden="true">
            <circle cx="26" cy="26" r="24" />
            <path d="M15 27l7 7 15-15" />
          </svg>
          <h3 id="sv-sheet-title">{guide.name} est connecté</h3>
        </div>
        <dl className="sv-facts">
          {status.facts
            .filter((fact) => !(showVoicePicker && fact.label === 'Voix'))
            .map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
        </dl>
        {showVoicePicker ? (
          <>
            <label className="sv-voice">
              <span>Voix utilisée</span>
              <select
                value={status.settings.voice?.id ?? ''}
                onChange={(event) => void pickVoice(event.target.value)}
              >
                {status.settings.voice === undefined ? (
                  <option value="">Choisis la voix de la créatrice</option>
                ) : null}
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="sv-hint" data-error={voiceError !== null} aria-live="polite">
              {voiceError?.message ?? 'Chaque vocal passe par toi avant d’être envoyé.'}
            </p>
            {voiceError?.isSessionExpired === true ? <SignInAgain /> : null}
          </>
        ) : null}
        {isReplace ? (
          <a className="nv-btn sv-btn--quiet" href={guide.console.url} target="_blank" rel="noreferrer">
            L’ancienne clé ne sert plus : supprime-la chez {guide.vendor} ↗
          </a>
        ) : null}
        <div className="sv-foot">
          <button
            type="button"
            className="nv-btn nv-btn--neon sv-grow"
            onClick={() => {
              onFinish(after.provider);
            }}
          >
            {after.label}
          </button>
        </div>
      </Scrim>
    );
  }

  const error = phase.kind === 'edit' ? phase.error : null;
  const showStepOne = !hasOpenedConsole || isStepOneOpen;
  return (
    <Scrim onClose={close}>
      <header className="sv-sheet__head">
        <div className="sv-sheet__title">
          <h3 id="sv-sheet-title">
            {isReplace ? `Remplacer la clé de ${guide.name}` : `Connecter ${guide.name}`}
          </h3>
          <p>{guide.role}</p>
        </div>
        {closeLabel}
      </header>
      <ol className="sv-steps">
        <li className="sv-step" data-state={hasOpenedConsole ? 'done' : 'now'}>
          <span className="sv-num">{hasOpenedConsole ? CHECK : '1'}</span>
          <div className="sv-step__head">
            Crée une clé chez {guide.vendor}
            {hasOpenedConsole ? (
              <button
                type="button"
                className="sv-link"
                onClick={() => {
                  setIsStepOneOpen(!isStepOneOpen);
                }}
              >
                {isStepOneOpen ? 'Masquer' : 'Revoir'}
              </button>
            ) : null}
          </div>
          {showStepOne ? (
            <div className="sv-step__body">
              <span className="sv-muted">{guide.where}</span>
              <ul className="sv-ticks">
                {guide.ticks.map((tick) => (
                  <li key={tick.label}>
                    <b>{tick.label}</b>
                    {tick.copy === true ? (
                      <CopyChip value={tick.value} />
                    ) : tick.code === true ? (
                      <code>{tick.value}</code>
                    ) : (
                      <span>{tick.value}</span>
                    )}
                  </li>
                ))}
              </ul>
              {guide.note === null ? null : <p className="sv-note">{guide.note}</p>}
              <a
                className={hasOpenedConsole ? 'nv-btn nv-btn--soft' : 'nv-btn nv-btn--neon'}
                href={guide.console.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  setIsConsoleOpening(true);
                }}
              >
                {guide.console.label} ↗
              </a>
            </div>
          ) : null}
        </li>
        <li className="sv-step" data-state={hasOpenedConsole ? 'now' : 'later'}>
          <span className="sv-num">2</span>
          <div className="sv-step__head">
            {phase.kind === 'reauth' ? 'Confirme ton mot de passe Nirvana' : 'Colle-la ici'}
          </div>
          {phase.kind === 'reauth' ? (
            <div className="sv-step__body">
              <PasswordPrompt
                lead="Ta connexion date de plus de 10 minutes : pour toucher à une clé, Nirvana redemande ton mot de passe."
                note="Ta clé est gardée, elle sera vérifiée juste après."
                onBusyChange={setIsReauthBusy}
                onConfirmed={() => {
                  void submit(phase.key, true);
                }}
                onCancel={() => {
                  setPhase({ kind: 'edit', error: null });
                }}
              />
            </div>
          ) : hasOpenedConsole ? (
            <div className="sv-step__body">
              <form
                className="sv-key"
                data-error={error !== null}
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit(keyInput.current?.value ?? '');
                }}
              >
                {/*
                  Not `type=password`: a password manager would offer to save the key, or fill in the dashboard
                  password, which would then go to the provider. The field is masked by CSS instead.
                */}
                <input
                  ref={keyInput}
                  type="text"
                  className="sv-key__secret"
                  name="nv-service-key"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-1p-ignore=""
                  data-lpignore="true"
                  data-form-type="other"
                  data-bwignore=""
                  aria-label={`Clé ${guide.vendor}`}
                  aria-invalid={error !== null}
                  aria-describedby="sv-key-msg"
                  placeholder="Nirvana la vérifie toute seule"
                  disabled={isBusy}
                  onPaste={(event) => {
                    event.preventDefault();
                    const pasted = normalizeKey(event.clipboardData.getData('text'));
                    event.currentTarget.value = pasted;
                    void submit(pasted);
                  }}
                />
                <button type="submit" className="nv-btn nv-btn--soft nv-btn--sm" disabled={isBusy}>
                  Vérifier
                </button>
              </form>
              <p
                id="sv-key-msg"
                className="sv-msg"
                data-kind={isBusy ? 'busy' : error === null ? 'none' : 'error'}
                aria-live="polite"
              >
                {isBusy ? (
                  <>
                    <span className="sv-dot" data-dot="busy" />
                    Vérification auprès de {guide.vendor}…
                  </>
                ) : (
                  error?.message
                )}
              </p>
              {!isBusy && error?.isSessionExpired === true ? <SignInAgain /> : null}
            </div>
          ) : null}
        </li>
      </ol>
      <div className="sv-foot">
        {hasOpenedConsole ? null : (
          <button
            type="button"
            className="nv-btn sv-btn--quiet"
            onClick={() => {
              setHasOpenedConsole(true);
              setIsStepOneOpen(false);
            }}
          >
            J’ai déjà ma clé
          </button>
        )}
        {guide.isRequired ? null : (
          <button type="button" className="nv-btn sv-btn--quiet" disabled={isBusy} onClick={close}>
            Plus tard
          </button>
        )}
      </div>
    </Scrim>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])';

/**
 * A modal sheet: Tab stays inside it, and closing it gives focus back to whatever opened it (a row's button, the
 * next-action button), when that is still on the page.
 */
function Scrim({ children, onClose }: { children: ReactNode; onClose: () => void }): JSX.Element {
  const sheet = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => document.activeElement);
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    },
    [opener],
  );
  // Portalled to <body>: an ancestor's transform or filter (the page's entrance) would otherwise trap the fixed scrim.
  return createPortal(
    <div
      className="sv-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={sheet}
        className="sv-sheet nv-glass nv-glass--thick"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sv-sheet-title"
        onKeyDown={(event) => {
          if (event.key !== 'Tab' || sheet.current === null) return;
          const items = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
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
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
