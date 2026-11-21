import type { CreatorId, PreparedScriptView } from '@impera/contracts';
import { useState, type JSX, type ReactNode } from 'react';

import { PreparedScriptsView } from './PreparedScriptsView';
import { ScriptsToCopyView } from './ScriptsToCopyView';
import { ViewTabs } from './ViewTabs';
import { usePreparedScripts } from './api';
import './prepared.css';

type View = 'scripts' | 'copy';

/**
 * Créatrices › Scripts (ADR 0149 § 1, ADR 0112 §§ 20-24), the owner's and an active manager's: the two views of one
 * tab behind their switch. Each view stands alone (`PreparedScriptsView`, `ScriptsToCopyView`) for a screen that
 * places them itself.
 */
export function ScriptsTab({
  creatorId,
  creatorName,
  sent,
}: {
  creatorId: CreatorId;
  creatorName: string;
  /** « À copier dans Reveal »'s second part: the scripts she sent, and her vault above them for now. */
  sent: ReactNode;
}): JSX.Element {
  const scripts = usePreparedScripts(creatorId);
  const [view, setView] = useState<View>('scripts');
  // A script opened from « À copier », and a count that remounts « Scripts » on each switch so it opens on the list.
  const [opening, setOpening] = useState<{ readonly script: PreparedScriptView | null; readonly at: number }>(
    {
      script: null,
      at: 0,
    },
  );
  const ready = (scripts.data ?? []).filter((one) => one.state === 'ready_to_copy').length;
  const show = (next: View, script: PreparedScriptView | null = null): void => {
    setView(next);
    setOpening((before) => ({ script, at: before.at + 1 }));
  };

  return (
    <div className="se-page">
      <div className="se-filters">
        <ViewTabs<View>
          label="Vue des scripts"
          value={view}
          onChange={(next) => {
            show(next);
          }}
          views={[
            ['scripts', 'Scripts'],
            [
              'copy',
              <>
                <span className="se-lg">À copier dans Reveal</span>
                <span className="se-sh">À copier</span>
                {ready > 0 ? <span className="nv-count nv-subnav__count">{ready}</span> : null}
              </>,
            ],
          ]}
        />
      </div>
      {view === 'copy' ? (
        <ScriptsToCopyView
          creatorId={creatorId}
          creatorName={creatorName}
          sent={sent}
          onOpen={(script) => {
            show('scripts', script);
          }}
        />
      ) : (
        <PreparedScriptsView
          key={opening.at}
          creatorId={creatorId}
          creatorName={creatorName}
          opening={opening.script}
          onCopy={() => {
            show('copy');
          }}
        />
      )}
    </div>
  );
}
