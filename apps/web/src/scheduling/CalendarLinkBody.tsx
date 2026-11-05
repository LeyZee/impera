import { useEffect, useRef, useState, type JSX } from 'react';

import { CopyButton } from '@/auth/BackupCodesList';
import {
  createCalendarLink,
  revokeCalendarLink,
  useCalendarLink,
  useRefreshPlanning,
  type Refusal,
} from '@/scheduling/api';
import { feedAddresses, type FeedAddresses } from '@/scheduling/calendar-link';
import { ERROR_MESSAGES } from '@/scheduling/model';

const MUTED = 'text-sm text-[var(--nv-ink-muted)]';
const UNAVAILABLE = 'Le serveur ne répond pas. Réessaie dans un instant.';

const wordsOf = (refusal: Refusal): string =>
  refusal.kind === 'refused' ? ERROR_MESSAGES[refusal.code] : UNAVAILABLE;

const sinceWords = (at: string): string =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(at));

/** What the link carries, in the words of whoever holds it: a member's shifts, or a creator's agenda. */
export interface CalendarLinkWords {
  /** Before the link exists: what it does and what goes in it. */
  readonly intro: string;
  /** Under the address shown once: who may read it. */
  readonly made: string;
  /** Before « Couper »: what stops. */
  readonly stopped: string;
}

/** A member's (Moi › Calendrier, CR-12). */
export const SHIFT_LINK_WORDS: CalendarLinkWords = {
  intro:
    'Ajoute tes shifts au calendrier de ton téléphone\u00a0: ils s’y mettent à jour tout seuls. Le Calendrier d’Apple les relit à peu près toutes les heures\u00a0; Google Agenda peut mettre jusqu’à une journée. Seuls tes shifts y vont, avec le créneau et la créatrice, rien d’autre.',
  made: 'Garde-le pour toi\u00a0: quiconque l’a voit tes shifts.',
  stopped: 'Le calendrier où tu l’as ajouté ne recevra plus tes shifts.',
};

/**
 * A secret, read-only calendar link (CR-12, ADR 0045 § 5; her agenda's, CR-05 lot c2): the server keeps only its
 * fingerprint, so the address is shown once, when it is made; afterwards it says since when it works, and lets the
 * holder replace or stop it.
 *
 * Keyboard focus follows the content: the address when it is shown, « Annuler » in a confirmation, and the first
 * sentence when it comes back, so a screen reader says what changed instead of falling back to the page.
 */
type Step = 'idle' | 'replace' | 'stop';

export function CalendarLinkBody({
  words,
  onShown,
}: {
  words: CalendarLinkWords;
  /** While the address is shown, and when it is put away: a dialog around it then holds still (CR-05). */
  onShown?: (shown: boolean) => void;
}): JSX.Element {
  const state = useCalendarLink();
  const refresh = useRefreshPlanning();
  const [made, setMade] = useState<FeedAddresses | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The panel's first sentence takes the focus back when the button that had it goes away.
  const lead = useRef<HTMLParagraphElement>(null);
  const [refocus, setRefocus] = useState(false);
  const live = state.data?.link ?? null;
  useEffect(() => {
    if (!refocus || lead.current === null) return;
    lead.current.focus();
    setRefocus(false);
  }, [refocus, live, made, step]);

  async function make(): Promise<void> {
    setBusy(true);
    setError(null);
    const outcome = await createCalendarLink();
    setBusy(false);
    if (outcome.kind !== 'ok') {
      setError(wordsOf(outcome));
      return;
    }
    setMade(feedAddresses(outcome.value.path, window.location.origin));
    onShown?.(true);
    setStep('idle');
    await refresh();
  }

  async function stop(): Promise<void> {
    setBusy(true);
    setError(null);
    const outcome = await revokeCalendarLink();
    setBusy(false);
    if (outcome.kind !== 'ok') {
      setError(wordsOf(outcome));
      return;
    }
    setStep('idle');
    await refresh();
    setRefocus(true);
  }

  return (
    <>
      {made !== null ? (
        <Made
          addresses={made}
          warning={words.made}
          onDone={() => {
            setMade(null);
            onShown?.(false);
            setRefocus(true);
          }}
        />
      ) : state.isPending ? (
        <p className={MUTED}>Lecture…</p>
      ) : state.isError ? (
        <>
          <p className="text-sm text-[var(--nv-warning)]">{UNAVAILABLE}</p>
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm self-start"
            onClick={() => void state.refetch()}
          >
            Réessayer
          </button>
        </>
      ) : live === null ? (
        <>
          <p ref={lead} tabIndex={-1} className={`${MUTED} outline-none`}>
            {words.intro}
          </p>
          <button
            type="button"
            className="nv-btn nv-btn--neon nv-btn--sm self-start"
            disabled={busy}
            onClick={() => void make()}
          >
            {busy ? 'Création…' : 'Créer mon lien'}
          </button>
        </>
      ) : (
        <>
          <p ref={lead} tabIndex={-1} className="text-sm outline-none">
            Ton lien marche depuis le {sinceWords(live.createdAt)}.
          </p>
          {step === 'idle' ? (
            <>
              <p className={MUTED}>
                Tu l’as perdu, ou quelqu’un d’autre l’a&nbsp;? Remplace-le&nbsp;: l’ancien cessera de marcher.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="nv-btn nv-btn--soft nv-btn--sm"
                  onClick={() => {
                    setStep('replace');
                  }}
                >
                  Remplacer le lien
                </button>
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm"
                  onClick={() => {
                    setStep('stop');
                  }}
                >
                  Couper le lien
                </button>
              </div>
            </>
          ) : (
            <Confirm
              words={
                step === 'replace'
                  ? 'L’ancien lien cessera de marcher\u00a0: tu ajouteras le nouveau à ton calendrier.'
                  : words.stopped
              }
              act={step === 'replace' ? 'Remplacer' : 'Couper'}
              busy={busy}
              onConfirm={() => void (step === 'replace' ? make() : stop())}
              onCancel={() => {
                setStep('idle');
                setError(null);
                setRefocus(true);
              }}
            />
          )}
        </>
      )}
      {error === null ? null : (
        <p role="alert" className="text-sm text-[var(--nv-warning)]">
          {error}
        </p>
      )}
    </>
  );
}

/** The address, shown once, and focused so that it is read out: added to Apple's Calendar or Google Agenda, or copied. */
function Made({
  addresses,
  warning,
  onDone,
}: {
  addresses: FeedAddresses;
  warning: string;
  onDone: () => void;
}): JSX.Element {
  const shown = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    shown.current?.focus();
  }, []);
  return (
    <>
      <p className="text-sm">
        Voici ton lien. Il ne sera plus affiché&nbsp;: ajoute-le maintenant. {warning}
      </p>
      <p
        ref={shown}
        tabIndex={-1}
        className="nv-glass break-all rounded-[var(--nv-radius-md)] px-4 py-3 font-mono text-sm"
        aria-label="Ton lien de calendrier"
      >
        {addresses.https}
      </p>
      <div className="flex flex-wrap gap-2">
        <a className="nv-btn nv-btn--neon nv-btn--sm" href={addresses.webcal}>
          Ajouter au Calendrier d’Apple
        </a>
        <a
          className="nv-btn nv-btn--soft nv-btn--sm"
          href={addresses.google}
          target="_blank"
          rel="noopener noreferrer"
        >
          Ajouter à Google Agenda
        </a>
        <CopyButton text={addresses.https} label="Copier le lien" shown={shown} />
      </div>
      <button type="button" className="nv-btn nv-btn--plain nv-btn--sm self-start" onClick={onDone}>
        C’est fait
      </button>
    </>
  );
}

function Confirm({
  words,
  act,
  busy,
  onConfirm,
  onCancel,
}: {
  words: string;
  act: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  // « Annuler » takes the focus: the safe choice for a step that stops a link.
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{words}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="nv-btn nv-btn--neon nv-btn--sm" disabled={busy} onClick={onConfirm}>
          {busy ? `${act}…` : act}
        </button>
        <button
          ref={cancel}
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm"
          disabled={busy}
          onClick={onCancel}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
