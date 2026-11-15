import type { CreatorId } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import { SWITCH_FAILED, setDescribeSwitch, switchKey, useDescribeSwitch } from './review-api';
import './scripts.css';

/**
 * Her switch of the descriptions (ADR 0083 § 9), the owner's: on, each photo and video she drops is described by the
 * vision AI, then read again before any use; what she dropped while it was off is described at once. It holds for
 * every drop of hers, so it stands in Contenu, beside them (recette créatrice 6).
 */
export function DescribeSwitch({
  creatorId,
  creatorName,
}: {
  creatorId: CreatorId;
  creatorName: string;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const current = useDescribeSwitch(creatorId, true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const turn = async (on: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    const answer = await setDescribeSwitch(creatorId, on);
    setBusy(false);
    if (answer === null) {
      setError(SWITCH_FAILED);
      return;
    }
    client.setQueryData(switchKey(creatorId), answer);
  };

  return (
    <div className="nv-plate sx-switch">
      <div className="sx-switch__text">
        <label className="sx-switch__title" htmlFor={id}>
          Descriptions par l’IA
        </label>
        <p className="ps-muted">
          {current.data === true
            ? `Chaque photo et vidéo de ${creatorName} est décrite à son arrivée, puis relue avant tout usage.`
            : `Éteint : ses médias ne sont pas décrits. Allumé, ce qu’elle a déjà déposé l’est aussi.`}
        </p>
        {error === null ? null : (
          <p className="sx-error nv-swap" role="alert">
            {error}
          </p>
        )}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="nv-switch"
        checked={current.data === true}
        disabled={busy || current.data === undefined}
        aria-busy={busy}
        onChange={(event) => {
          void turn(event.target.checked);
        }}
      />
    </div>
  );
}
