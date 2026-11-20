import type { CreatorId, PreparedScriptView } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { PreparedEditor } from './PreparedEditor';
import { PreparedList } from './PreparedList';
import { preparedKey, usePreparedScripts } from './api';
import { NewScriptDialog } from './dialogs';
import { vaultAccounts } from './media';
import { useEditorMedia } from './useEditorMedia';
import './prepared.css';

import { Empty, Failure } from '@/shell/states';

/**
 * « Scripts » (ADR 0112 § 20), standing alone: her scripts in preparation, « Nouveau script » and the editor. `opening`
 * is a script to open at once, given by the caller (from « À copier dans Reveal »); `onCopy` is called when the editor
 * sends the person to copy it.
 */
export function PreparedScriptsView({
  creatorId,
  creatorName,
  opening = null,
  onCopy,
}: {
  creatorId: CreatorId;
  creatorName: string;
  opening?: PreparedScriptView | null;
  onCopy: () => void;
}): JSX.Element {
  const client = useQueryClient();
  const scripts = usePreparedScripts(creatorId);
  const { vault, media, folders } = useEditorMedia(creatorId);
  const [editing, setEditing] = useState<PreparedScriptView | null>(opening);
  const [creating, setCreating] = useState(false);

  const remember = (saved: PreparedScriptView): void => {
    client.setQueryData<readonly PreparedScriptView[]>(preparedKey(creatorId), (before) =>
      before === undefined
        ? [saved]
        : before.some((one) => one.id === saved.id)
          ? before.map((one) => (one.id === saved.id ? saved : one))
          : [saved, ...before],
    );
  };

  const list = (): JSX.Element => {
    if (scripts.data === undefined) {
      if (scripts.isError)
        return <Failure title="Ses scripts ne se chargent pas" onRetry={() => void scripts.refetch()} />;
      return <div className="nv-plate nv-plate--pad se-skel" aria-busy="true" />;
    }
    if (scripts.data.length === 0)
      return (
        <Empty plate title="Pas encore de script">
          Écris le premier à partir des médias décrits de son coffre : étapes, branches, prix. Il se recopie
          ensuite à la main dans Reveal.
        </Empty>
      );
    return <PreparedList scripts={scripts.data} onOpen={setEditing} />;
  };

  return (
    <section className="se-page" aria-label={`Scripts de ${creatorName}`}>
      {editing === null ? (
        <>
          <div className="se-filters">
            <h2 className="nv-h2">Ses scripts</h2>
            <button
              type="button"
              className="nv-btn nv-btn--neon"
              onClick={() => {
                setCreating(true);
              }}
            >
              ＋ Nouveau script
            </button>
          </div>
          {list()}
        </>
      ) : (
        <PreparedEditor
          key={`${editing.id}:${String(editing.revision)}`}
          creatorId={creatorId}
          creatorName={creatorName}
          initial={editing}
          media={media}
          folders={folders}
          onSaved={remember}
          onReload={() => {
            void scripts.refetch().then((read) => {
              const fresh = read.data?.find((one) => one.id === editing.id);
              if (fresh !== undefined) setEditing(fresh);
            });
          }}
          onCopy={() => {
            setEditing(null);
            onCopy();
          }}
          onBack={() => {
            setEditing(null);
          }}
        />
      )}
      {creating ? (
        <NewScriptDialog
          creatorId={creatorId}
          creatorName={creatorName}
          accounts={vaultAccounts(vault)}
          onClose={() => {
            setCreating(false);
          }}
          onCreated={(created) => {
            remember(created);
            setCreating(false);
            setEditing(created);
          }}
        />
      ) : null}
    </section>
  );
}
