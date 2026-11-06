import type { PersonaVersionSummary } from '@impera/contracts';
import { useEffect, useState, type JSX } from 'react';

/** How long a « Réactiver » waits for its second click, as « Activer » in the head. */
const CONFIRM_MS = 4000;

const WHEN = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** « 3 versions · active : 0.1.0 »: what the fold holds, without opening it. */
function versionsSum(versions: readonly PersonaVersionSummary[]): string {
  const active = versions.find((v) => v.isActive);
  return `${String(versions.length)} versions · ${active === undefined ? 'aucune active' : `active : ${active.version}`}`;
}

/**
 * Her stored versions, folded under the head (recette AGT-07): a bad version made active is undone here, by putting an
 * older one back in service, never by typing it again. The newest one is activated from the head, where its content
 * shows; every older one offers « Réactiver la version N », a second click confirming it like « Activer ». Nothing is
 * shown before she has two versions: the head says all of one.
 */
export function Versions({
  versions,
  canActivate,
  busy,
  onActivate,
}: {
  /** Newest first. */
  versions: readonly PersonaVersionSummary[];
  /** The owner, who alone chooses the version in force; a manager reads the list. */
  canActivate: boolean;
  /** A save or an activation is under way: no second one starts. */
  busy: boolean;
  onActivate: (version: PersonaVersionSummary) => void;
}): JSX.Element | null {
  /** The version whose « Réactiver » was clicked once, waiting for « Confirmer ». */
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => {
    if (confirming === null) return;
    const timer = setTimeout(() => {
      setConfirming(null);
    }, CONFIRM_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [confirming]);

  if (versions.length < 2) return null;
  const newest = versions[0]?.id;
  return (
    <details className="nv-plate nv-disclosure ps-versions">
      <summary>
        <span className="nv-disclosure__title">Ses versions</span>
        <span className="nv-disclosure__sum">{versionsSum(versions)}</span>
      </summary>
      <div className="nv-disclosure__body">
        <p className="ps-muted ps-versions__lead">
          {canActivate
            ? 'Réactiver une version plus ancienne la remet en service pour tous ses fans. Rien n’est effacé : tu peux revenir à n’importe laquelle.'
            : 'Seul le propriétaire choisit la version avec laquelle l’agent écrit.'}
        </p>
        <ul className="ps-versions__list">
          {versions.map((version) => (
            <li key={version.id} className="ps-versions__item">
              <span className="ps-versions__name">Version {version.version}</span>
              <span className="ps-versions__when">{WHEN.format(new Date(version.createdAt))}</span>
              {version.isActive ? (
                <span className="nv-tag nv-tag--declared ps-versions__end">Active</span>
              ) : version.id === newest ? (
                <span className="ps-versions__end ps-versions__note">La plus récente</span>
              ) : canActivate ? (
                <button
                  type="button"
                  className="nv-btn nv-btn--soft nv-btn--sm ps-versions__end"
                  disabled={busy}
                  title="Elle redevient sa version active, à la place de celle d’aujourd’hui."
                  onClick={() => {
                    if (confirming === version.id) {
                      setConfirming(null);
                      onActivate(version);
                    } else setConfirming(version.id);
                  }}
                >
                  {confirming === version.id
                    ? `Confirmer la version ${version.version}`
                    : `Réactiver la version ${version.version}`}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
