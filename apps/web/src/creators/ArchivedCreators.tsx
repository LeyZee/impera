import type { CreatorId } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type JSX } from 'react';

import { restoreCreator, useArchivedCreators, type RestoreResult } from './api';

import { PasswordPrompt, SignInAgain } from '@/settings/services/PasswordPrompt';

import './archived.css';

type Problem = Exclude<RestoreResult['kind'], 'restored' | 'reauth'>;

const PROBLEMS: Record<Problem, string> = {
  forbidden: 'Seul le compte propriétaire rouvre une créatrice.',
  not_found: 'Cette créatrice n’existe plus.',
  expired: 'Ta session a expiré : reconnecte-toi, puis recommence.',
  failed: 'Elle n’est pas rouverte : Impera ne répond pas. Réessaie dans un instant.',
};

const dayOf = (iso: string): string =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

/**
 * Créatrices › Archivées (ADR 0071 § 2), the owner's alone, folded: shown only when one is archived. « Rouvrir »
 * lists her again, her agent still off and her space closed until a new link.
 */
export function ArchivedCreators({
  onRestored,
}: {
  onRestored: (id: CreatorId) => void;
}): JSX.Element | null {
  const client = useQueryClient();
  const query = useArchivedCreators(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const sending = useRef(false);
  const [reauthId, setReauthId] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const archived = query.data ?? [];

  async function restore(id: string): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setBusyId(id);
    setProblem(null);
    const result = await restoreCreator(id);
    sending.current = false;
    setBusyId(null);
    if (result.kind === 'restored') {
      setNotice(
        `Rouverte : ${result.creator.displayName}. Son agent reste à l’arrêt : relance-le depuis le Dashboard. Son espace se rouvre avec un nouveau lien, dans l’onglet Accès.`,
      );
      await client.invalidateQueries({ queryKey: ['creators'] });
      onRestored(result.creator.id);
    } else if (result.kind === 'reauth') {
      setReauthId(id);
    } else {
      setProblem(result.kind);
    }
  }

  if (archived.length === 0 && notice === null) return null;
  return (
    <div className="ps-stack cr-archived">
      {notice === null ? null : (
        <p className="ps-muted" role="status">
          {notice}
        </p>
      )}
      {archived.length === 0 ? null : (
        <details className="nv-disclosure">
          <summary>
            <span className="nv-disclosure__title">Archivées</span>
            <span className="nv-disclosure__sum">
              {archived.length === 1 ? '1 créatrice' : `${String(archived.length)} créatrices`}
            </span>
          </summary>
          <ul className="nv-disclosure__body cr-archived__list">
            {archived.map((creator) => (
              <li key={creator.id} className="cr-archived__row">
                <span>
                  {creator.displayName}
                  <span className="ps-muted"> · archivée le {dayOf(creator.archivedAt)}</span>
                </span>
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm"
                  disabled={busyId !== null || reauthId !== null}
                  aria-busy={busyId === creator.id}
                  onClick={() => void restore(creator.id)}
                >
                  {busyId === creator.id ? 'Réouverture…' : 'Rouvrir'}
                </button>
              </li>
            ))}
          </ul>
          {problem === null ? null : (
            <p className="ps-error" role="alert">
              {PROBLEMS[problem]}
            </p>
          )}
          {problem === 'expired' ? <SignInAgain /> : null}
          {reauthId === null ? null : (
            <PasswordPrompt
              lead="Pour la rouvrir, confirme ton mot de passe et ton code."
              onConfirmed={() => {
                const id = reauthId;
                setReauthId(null);
                void restore(id);
              }}
              onCancel={() => {
                setReauthId(null);
              }}
            />
          )}
        </details>
      )}
    </div>
  );
}
