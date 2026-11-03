import type { Me } from '@nirvana/contracts';
import { useRef, useState, type JSX } from 'react';

import { MeNav } from './MeNav';

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
import { Page, PageHeader, Panel, PanelSection } from '@/shell/layout';

const MUTED = 'text-sm text-[var(--nv-ink-muted)]';
const UNAVAILABLE = 'Le serveur ne répond pas. Réessaie dans un instant.';

const wordsOf = (refusal: Refusal): string =>
  refusal.kind === 'refused' ? ERROR_MESSAGES[refusal.code] : UNAVAILABLE;

const sinceWords = (at: string): string =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(at));

/**
 * Moi › Agenda (CR-12, ADR 0045 § 5): the member's own shifts in the calendar of his phone, through a secret,
 * read-only link. The server keeps only its fingerprint, so the address is shown once, when it is made; afterwards
 * the screen says since when it works, and lets him replace or stop it.
 */
export function MyCalendarLinkPage({ user }: { user: Me }): JSX.Element {
  return (
    <Page>
      <PageHeader
        eyebrow="Moi"
        title="Agenda"
        lead="Tes shifts dans l’agenda de ton téléphone, mis à jour tout seuls."
        actions={<MeNav manager={user.teamScope === 'agency'} />}
      />
      {/* In a column, as Moi › Sécurité: the panel keeps its own height instead of filling the page. */}
      <div className="flex flex-col gap-4">
        <CalendarLinkPanel />
      </div>
    </Page>
  );
}

type Step = 'idle' | 'replace' | 'stop';

function CalendarLinkPanel(): JSX.Element {
  const state = useCalendarLink();
  const refresh = useRefreshPlanning();
  const [made, setMade] = useState<FeedAddresses | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }

  const live = state.data?.link ?? null;
  return (
    <Panel title="Mes shifts dans mon agenda" eyebrow="Apple Agenda, Google Agenda">
      <PanelSection>
        {made !== null ? (
          <Made
            addresses={made}
            onDone={() => {
              setMade(null);
            }}
          />
        ) : state.isPending ? (
          <p className={MUTED}>Lecture…</p>
        ) : state.isError ? (
          <p className="text-sm text-[var(--nv-warning)]">{UNAVAILABLE}</p>
        ) : live === null ? (
          <>
            <p className={MUTED}>
              Ajoute tes shifts à l’agenda de ton téléphone&nbsp;: ils s’y mettent à jour tout seuls, à peu
              près toutes les heures. Seuls tes shifts y vont, avec le créneau et la créatrice, rien d’autre.
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
            <p className="text-sm">Ton lien marche depuis le {sinceWords(live.createdAt)}.</p>
            {step === 'idle' ? (
              <>
                <p className={MUTED}>
                  Tu l’as perdu, ou quelqu’un d’autre l’a&nbsp;? Remplace-le&nbsp;: l’ancien cessera de
                  marcher.
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
                    ? 'L’ancien lien cessera de marcher : tu ajouteras le nouveau à ton agenda.'
                    : 'L’agenda où tu l’as ajouté ne recevra plus tes shifts.'
                }
                act={step === 'replace' ? 'Remplacer' : 'Couper'}
                busy={busy}
                onConfirm={() => void (step === 'replace' ? make() : stop())}
                onCancel={() => {
                  setStep('idle');
                  setError(null);
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
      </PanelSection>
    </Panel>
  );
}

/** The address, shown once: added to Apple Agenda or Google Agenda, or copied. */
function Made({ addresses, onDone }: { addresses: FeedAddresses; onDone: () => void }): JSX.Element {
  const shown = useRef<HTMLParagraphElement>(null);
  return (
    <>
      <p className="text-sm">
        Voici ton lien. Il ne sera plus affiché&nbsp;: ajoute-le maintenant. Garde-le pour toi, qui l’a voit
        tes shifts.
      </p>
      <p
        ref={shown}
        className="nv-glass break-all rounded-[var(--nv-radius-md)] px-4 py-3 font-mono text-sm"
        aria-label="Ton lien de calendrier"
      >
        {addresses.https}
      </p>
      <div className="flex flex-wrap gap-2">
        <a className="nv-btn nv-btn--neon nv-btn--sm" href={addresses.webcal}>
          Ajouter à Apple Agenda
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
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{words}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="nv-btn nv-btn--neon nv-btn--sm" disabled={busy} onClick={onConfirm}>
          {busy ? `${act}…` : act}
        </button>
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" disabled={busy} onClick={onCancel}>
          Annuler
        </button>
      </div>
    </div>
  );
}
