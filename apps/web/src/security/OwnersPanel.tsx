import type { Owner, OwnerCandidate, Owners } from '@impera/contracts';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { SecurityError } from './api';
import {
  addOwner,
  cancelOwnerRemoval,
  CANDIDATE_REFUSALS,
  effectiveText,
  fetchOwners,
  ownerMessageOf,
  remainingText,
  requestOwnerRemoval,
} from './owners';
import { passkeysText } from './view';

import { PasswordPrompt } from '@/settings/services/PasswordPrompt';
import { Panel, PanelSection } from '@/shell/layout';

const MUTED = 'text-sm text-[var(--nv-ink-muted)]';
const ROWS = 'flex flex-col divide-y divide-[var(--nv-hairline)]';
const BOX = 'nv-glass flex flex-col gap-3 rounded-[var(--nv-radius-md)] p-3';

/** What the owner is about to do, said back to him before it is done; then asked again with his password if needed. */
type Step =
  | { readonly act: 'add'; readonly userId: string; readonly name: string }
  | { readonly act: 'remove'; readonly userId: string; readonly name: string }
  | { readonly act: 'cancel' };

/**
 * Réglages › Sécurité, for the owners (ADR 0096): who they are, a member made the second one, and the removal of one
 * by the other, which waits 72 hours and which the owner it is about cancels. Each gesture is said back before it is
 * done (no native dialog), then asks for the password and the code when they are not recent.
 */
export function OwnersPanel(): JSX.Element {
  const [state, setState] = useState<Owners | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await fetchOwners());
      setError(null);
    } catch (failure) {
      setError(ownerMessageOf(failure));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  function close(): void {
    setStep(null);
    setConfirming(false);
  }

  async function run(chosen: Step): Promise<void> {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      if (chosen.act === 'add') {
        setState(await addOwner(chosen.userId));
        setNotice(
          `${chosen.name} est maintenant propriétaire. Ses sessions sont fermées : il se reconnecte avec son code.`,
        );
        setChoosing(false);
      } else if (chosen.act === 'remove') {
        const next = await requestOwnerRemoval(chosen.userId);
        setState(next);
        setNotice(`Retrait demandé. ${chosen.name} est prévenu et peut l’annuler.`);
      } else {
        setState(await cancelOwnerRemoval());
        setNotice('Retrait annulé : tu restes propriétaire.');
      }
      close();
    } catch (failure) {
      if (failure instanceof SecurityError && failure.kind === 'reauth_required') {
        setStep(chosen);
        setConfirming(true);
      } else {
        setError(ownerMessageOf(failure));
        close();
        // What the screen offered was no longer true: read it again, and keep the refusal on screen.
        void fetchOwners().then(setState, () => undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  const you = state?.owners.find((owner) => owner.you);
  const removal = state?.removal ?? null;
  const nameOf = (userId: string): string =>
    state?.owners.find((owner) => owner.userId === userId)?.name ?? 'L’autre propriétaire';
  const noticeHours = state?.noticeHours ?? 72;

  return (
    <Panel title="Propriétaires" eyebrow="Compte de secours">
      <PanelSection>
        <p className={MUTED}>
          Deux propriétaires au plus, avec les mêmes droits : si l’un perd son téléphone, l’agence continue.
          Retirer un propriétaire prend {String(noticeHours)} h, et celui qui est visé peut annuler.
        </p>
        {state === null && error === null ? <p className={MUTED}>Chargement…</p> : null}

        {removal === null || you === undefined ? null : (
          <div className={BOX} role="group" aria-label="Retrait en attente">
            <span className="nv-status nv-status--awaiting-approval self-start">
              <span className="nv-status__dot" />
              Retrait en attente
            </span>
            {removal.targetUserId === you.userId ? (
              <p className="text-sm">
                {nameOf(removal.requestedBy)} a demandé ton retrait. Sans annulation, tu ne seras plus
                propriétaire {effectiveText(removal.effectiveAt)} (
                {remainingText(removal.effectiveAt, new Date())}
                ). Si ce n’est pas voulu, annule-le et change ton mot de passe.
              </p>
            ) : (
              <p className="text-sm">
                Tu as demandé le retrait de {nameOf(removal.targetUserId)}. Il prend effet{' '}
                {effectiveText(removal.effectiveAt)} ({remainingText(removal.effectiveAt, new Date())}). Lui
                seul peut l’annuler d’ici là : tu ne peux pas revenir sur ta demande.
              </p>
            )}
            {removal.targetUserId !== you.userId || step?.act === 'cancel' ? null : (
              <button
                type="button"
                className="nv-btn nv-btn--neon nv-btn--sm self-start"
                disabled={busy}
                onClick={() => void run({ act: 'cancel' })}
              >
                {busy ? 'Annulation…' : 'Annuler le retrait'}
              </button>
            )}
            {step?.act === 'cancel' && confirming ? (
              <PasswordPrompt
                lead="Pour annuler le retrait, confirme ton mot de passe et ton code."
                onConfirmed={() => void run({ act: 'cancel' })}
                onCancel={close}
              />
            ) : null}
          </div>
        )}

        {state === null ? null : (
          <ul className={ROWS} aria-label="Propriétaires">
            {state.owners.map((owner, index) => (
              <OwnerRow
                key={owner.userId}
                owner={owner}
                index={index}
                canRemove={!owner.you && removal === null}
                removalAsked={removal?.targetUserId === owner.userId}
                step={step}
                confirming={confirming}
                busy={busy}
                noticeHours={noticeHours}
                onAsk={() => {
                  setNotice(null);
                  setConfirming(false);
                  setStep({ act: 'remove', userId: owner.userId, name: owner.name });
                }}
                onRun={(chosen) => void run(chosen)}
                onClose={close}
              />
            ))}
          </ul>
        )}

        {state === null || state.owners.length >= 2 ? null : !choosing ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={MUTED}>Tu es seul propriétaire pour l’instant.</span>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              disabled={busy}
              onClick={() => {
                setChoosing(true);
                setNotice(null);
              }}
            >
              Ajouter un second propriétaire
            </button>
          </div>
        ) : (
          <div className={BOX} role="group" aria-label="Choisir le second propriétaire">
            <p className="text-sm">
              Choisis un membre de l’équipe. Il aura tous tes droits : réglages, paie, persona, passage en
              Automatique.
            </p>
            {state.candidates.length === 0 ? (
              <p className={MUTED}>
                Aucun membre dans l’équipe pour l’instant : invite d’abord ton associé dans Équipe › Membres.
              </p>
            ) : (
              <ul className={ROWS} aria-label="Membres de l’équipe">
                {state.candidates.map((candidate) => (
                  <CandidateRow
                    key={candidate.userId}
                    candidate={candidate}
                    step={step}
                    confirming={confirming}
                    busy={busy}
                    noticeHours={noticeHours}
                    onAsk={() => {
                      setConfirming(false);
                      setStep({ act: 'add', userId: candidate.userId, name: candidate.name });
                    }}
                    onRun={(chosen) => void run(chosen)}
                    onClose={close}
                  />
                ))}
              </ul>
            )}
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm self-start"
              disabled={busy}
              onClick={() => {
                setChoosing(false);
                close();
              }}
            >
              Fermer
            </button>
          </div>
        )}

        <p className={`${MUTED} min-h-5`} role="status" aria-live="polite">
          {error === null ? notice : <span className="text-[var(--nv-warning)]">{error}</span>}
        </p>
      </PanelSection>
    </Panel>
  );
}

interface RowProps {
  readonly step: Step | null;
  readonly confirming: boolean;
  readonly busy: boolean;
  readonly noticeHours: number;
  readonly onAsk: () => void;
  readonly onRun: (step: Step) => void;
  readonly onClose: () => void;
}

function OwnerRow({
  owner,
  index,
  canRemove,
  removalAsked,
  step,
  confirming,
  busy,
  noticeHours,
  onAsk,
  onRun,
  onClose,
}: RowProps & {
  readonly owner: Owner;
  readonly index: number;
  readonly canRemove: boolean;
  /** A removal of this owner waits for its notice: said beside the name, in the grey of « toi ». */
  readonly removalAsked: boolean;
}): JSX.Element {
  const mine = step?.act === 'remove' && step.userId === owner.userId ? step : null;
  return (
    <li className="nv-enter flex flex-col gap-3 py-3 first:pt-0" style={{ '--nv-i': index + 1 }}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2 font-semibold">
            {owner.name}
            {owner.you ? <span className="text-sm font-normal text-[var(--nv-ink-muted)]">toi</span> : null}
            {removalAsked ? (
              <span className="text-sm font-normal text-[var(--nv-ink-muted)]">retrait demandé</span>
            ) : null}
          </span>
          {/* Only what is worth saying: a code not active yet, keys that exist. */}
          <span className={`${MUTED} empty:hidden`}>
            {[
              owner.secondFactor ? null : 'Code à 6 chiffres pas encore activé',
              owner.passkeys === 0 ? null : passkeysText(owner.passkeys),
            ]
              .filter((part) => part !== null)
              .join(' · ')}
          </span>
        </div>
        {!canRemove || mine !== null ? null : (
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm shrink-0"
            disabled={busy}
            aria-label={`Demander le retrait de ${owner.name}`}
            onClick={onAsk}
          >
            Demander son retrait
          </button>
        )}
      </div>
      {mine === null ? null : confirming ? (
        <PasswordPrompt
          lead={`Pour demander le retrait de ${owner.name}, confirme ton mot de passe et ton code.`}
          onConfirmed={() => {
            onRun(mine);
          }}
          onCancel={onClose}
        />
      ) : (
        <div className={BOX} role="group" aria-label="Confirmer la demande de retrait">
          <p className="text-sm">
            {owner.name} ne sera plus propriétaire dans {String(noticeHours)} h. Il est prévenu tout de suite,
            sur Telegram et dans Impera, et peut annuler d’ici là.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="nv-btn nv-btn--neon nv-btn--sm"
              disabled={busy}
              onClick={() => {
                onRun(mine);
              }}
            >
              {busy ? 'Demande…' : 'Demander le retrait'}
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              disabled={busy}
              onClick={onClose}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function CandidateRow({
  candidate,
  step,
  confirming,
  busy,
  noticeHours,
  onAsk,
  onRun,
  onClose,
}: RowProps & { readonly candidate: OwnerCandidate }): JSX.Element {
  const mine = step?.act === 'add' && step.userId === candidate.userId ? step : null;
  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold">{candidate.name}</span>
          {candidate.refusal === null ? null : (
            <span className={MUTED}>{CANDIDATE_REFUSALS[candidate.refusal]}</span>
          )}
        </div>
        {candidate.refusal !== null || mine !== null ? null : (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm shrink-0"
            disabled={busy}
            aria-label={`Rendre ${candidate.name} propriétaire`}
            onClick={onAsk}
          >
            Rendre propriétaire
          </button>
        )}
      </div>
      {mine === null ? null : confirming ? (
        <PasswordPrompt
          lead={`Pour rendre ${candidate.name} propriétaire, confirme ton mot de passe et ton code.`}
          onConfirmed={() => {
            onRun(mine);
          }}
          onCancel={onClose}
        />
      ) : (
        <div className="flex flex-col gap-3" role="group" aria-label="Confirmer le second propriétaire">
          <p className="text-sm">
            {candidate.name} aura les mêmes droits que toi, et pourra demander ton retrait. Tu ne pourras lui
            retirer ce rôle qu’après {String(noticeHours)} h de préavis.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="nv-btn nv-btn--neon nv-btn--sm"
              disabled={busy}
              onClick={() => {
                onRun(mine);
              }}
            >
              {busy ? 'Un instant…' : `Rendre ${candidate.name} propriétaire`}
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              disabled={busy}
              onClick={onClose}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
