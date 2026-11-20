import type { CreatorId, PreparedScriptView } from '@impera/contracts';
import type { JSX, ReactNode } from 'react';

import { CopyView } from './CopyView';
import { usePreparedScripts } from './api';
import { useEditorMedia } from './useEditorMedia';
import './prepared.css';

/**
 * « À copier dans Reveal » (ADR 0112 §§ 21-22), standing alone: what is ready to copy by hand, then what she sent from
 * her phone (`sent`). Opening a script hands it to the caller, which shows it in « Scripts ».
 */
export function ScriptsToCopyView({
  creatorId,
  creatorName,
  sent,
  onOpen,
}: {
  creatorId: CreatorId;
  creatorName: string;
  /** The second part: the scripts she sent, and her vault above them for now. */
  sent: ReactNode;
  onOpen: (script: PreparedScriptView) => void;
}): JSX.Element {
  const scripts = usePreparedScripts(creatorId);
  const { media } = useEditorMedia(creatorId);
  return (
    <section className="se-page" aria-label={`Scripts de ${creatorName} à copier dans Reveal`}>
      <CopyView creatorId={creatorId} scripts={scripts.data ?? []} media={media} onOpen={onOpen} />
      {sent}
    </section>
  );
}
