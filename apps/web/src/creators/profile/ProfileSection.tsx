import type { JSX } from 'react';

import { NameEditor } from './NameEditor';
import './profile.css';

/**
 * Créatrices › Profil, the owner's alone (ADR 0071): her name as everyone reads it in Impera, renamed when it was typed
 * wrong. Nothing else of her lives here: her persona, her hours and her access have their own sheets.
 */
export function ProfileSection({
  creatorId,
  creatorName,
}: {
  creatorId: string;
  creatorName: string;
}): JSX.Element {
  return (
    <section className="nv-plate ps-panel cr-profile nv-enter" aria-label="Profil">
      <h2 className="ps-title">Son nom</h2>
      <NameEditor creatorId={creatorId} displayName={creatorName} />
    </section>
  );
}
