import { archivedThumbnailsUntil } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type JSX } from 'react';

import { archiveCreator, type ArchiveResult } from '../api';

import { PasswordPrompt, SignInAgain } from '@/settings/services/PasswordPrompt';

type Problem = Exclude<ArchiveResult['kind'], 'archived' | 'reauth' | 'planned'>;

/** What each refusal of `POST /v1/creators/:creatorId/archive` says; nothing of hers changed on any. */
const PROBLEMS: Record<Problem, string> = {
  forbidden: 'Seul le compte propriétaire archive une créatrice.',
  not_found: 'Cette créatrice n’existe plus.',
  expired: 'Ta session a expiré : reconnecte-toi, puis recommence. Elle n’est pas archivée.',
  failed: 'Elle n’est pas archivée : Impera ne répond pas. Réessaie dans un instant.',
};

/** « 2 shifts à venir et 1 shift régulier » : what still plans someone on her. */
export function plannedText(shiftsAhead: number, templatesRunning: number): string {
  const parts = [
    shiftsAhead === 0 ? null : `${String(shiftsAhead)} shift${shiftsAhead > 1 ? 's' : ''} à venir`,
    templatesRunning === 0
      ? null
      : `${String(templatesRunning)} shift${templatesRunning > 1 ? 's' : ''} régulier${templatesRunning > 1 ? 's' : ''}`,
  ].filter((part) => part !== null);
  return parts.join(' et ');
}

/**
 * Créatrices › Profil › Archiver (ADR 0071 § 2), the owner's alone: one confirmation that says what changes and what
 * stays. Refused while the planning still has her, with how many shifts to end first. Archived, she leaves the chips,
 * and the folded « Archivées » list of the page reopens her.
 */
export function ArchivePanel({
  creatorId,
  creatorName,
}: {
  creatorId: string;
  creatorName: string;
}): JSX.Element {
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [reauth, setReauth] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [planned, setPlanned] = useState<string | null>(null);
  const thumbnailsDay = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(archivedThumbnailsUntil(new Date()));

  async function archive(): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setProblem(null);
    setPlanned(null);
    const result = await archiveCreator(creatorId);
    sending.current = false;
    setBusy(false);
    if (result.kind === 'archived') {
      // Her sheet leaves with her: the page opens the next creator, and the « Archivées » list shows her.
      await client.invalidateQueries({ queryKey: ['creators'] });
    } else if (result.kind === 'reauth') {
      setReauth(true);
    } else if (result.kind === 'planned') {
      setPlanned(plannedText(result.planned.shiftsAhead, result.planned.templatesRunning));
    } else {
      setProblem(result.kind);
    }
  }

  return (
    <div className="ps-stack">
      <p className="ps-muted">
        Archivée, elle sort des listes, des Alertes et de Telegram, et son agent s’arrête. Ses conversations,
        ventes, paies, scripts et descriptions restent ; seules les vignettes de ses médias partent 90
        {'\u00a0'}jours après.
      </p>
      {asking ? (
        <div className="ps-stack cr-archive-confirm" role="group" aria-label={`Archiver ${creatorName}`}>
          <p className="cr-archive-ask">Archiver {creatorName} ?</p>
          <ul className="ps-muted cr-archive-list">
            <li>Son agent s’arrête : aucun brouillon, aucun envoi, aucune relance.</li>
            <li>Son espace se ferme : son lien est révoqué et elle ne peut plus se connecter.</li>
            <li>
              Ses vignettes sont effacées dans 90{'\u00a0'}jours, le {thumbnailsDay}. Rouverte avant, rien ne
              part.
            </li>
            <li>Tu pourras la rouvrir depuis Créatrices › Archivées. Son agent restera à l’arrêt.</li>
          </ul>
          {planned === null ? null : (
            <p className="ps-error" role="alert">
              Elle est encore au planning : {planned}. Retire-les dans l’agenda, puis archive-la.
            </p>
          )}
          {problem === null ? null : (
            <p className="ps-error" role="alert">
              {PROBLEMS[problem]}
            </p>
          )}
          {problem === 'expired' ? <SignInAgain /> : null}
          {reauth ? (
            <PasswordPrompt
              lead="Pour l’archiver, confirme ton mot de passe et ton code."
              onConfirmed={() => {
                setReauth(false);
                void archive();
              }}
              onCancel={() => {
                setReauth(false);
              }}
            />
          ) : null}
          {/* While the password is asked again, its own « Confirmer / Annuler » are the only buttons (no two « Annuler »). */}
          {reauth ? null : (
            <div className="ps-head__actions">
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                disabled={busy}
                onClick={() => {
                  setAsking(false);
                  setProblem(null);
                  setPlanned(null);
                  setReauth(false);
                }}
              >
                Annuler
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm"
                disabled={busy}
                aria-busy={busy}
                onClick={() => void archive()}
              >
                {busy ? 'Archivage…' : `Archiver ${creatorName}`}
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm ps-self-start"
          onClick={() => {
            setAsking(true);
          }}
        >
          Archiver…
        </button>
      )}
    </div>
  );
}
