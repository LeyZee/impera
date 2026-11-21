import type { CreatorId, PreparedScriptId, PreparedScriptView } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { PreparedEditor } from './PreparedEditor';
import { PreparedList } from './PreparedList';
import { preparedKey, usePreparedScripts } from './api';
import { NewScriptDialog } from './dialogs';
import { vaultAccounts } from './media';
import { useEditorMedia } from './useEditorMedia';
import './prepared.css';

import { ScriptArt } from '@/shell/art/EmptyArt';
import { Empty, Failure } from '@/shell/states';

/**
 * « Scripts » (ADR 0112 § 20), standing alone: her scripts in preparation, « Nouveau script » and the editor. `opening`
 * is a script to open at once, given by the caller (from « À copier dans Reveal »); `onCopy` is called when the editor
 * sends the person to copy it. With `onScript`, the script open is the address's (`scriptId`, PRO1-06): opening one
 * or going back to the list writes it, so a reload or the browser's step back lands where it was.
 */
export function PreparedScriptsView({
  creatorId,
  creatorName,
  opening = null,
  scriptId = null,
  onScript,
  onCopy,
}: {
  creatorId: CreatorId;
  creatorName: string;
  opening?: PreparedScriptView | null;
  /** The script the address opens; `null`, the list. Read only with `onScript`. */
  scriptId?: PreparedScriptId | null;
  onScript?: (id: PreparedScriptId | null) => void;
  onCopy: () => void;
}): JSX.Element {
  const client = useQueryClient();
  const scripts = usePreparedScripts(creatorId);
  const { vault, media, folders } = useEditorMedia(creatorId);
  const [held, setHeld] = useState<PreparedScriptView | null>(opening);
  const [creating, setCreating] = useState(false);
  // The address decides which script is open when it is given; the one held is its latest copy (saved, read again).
  const editing =
    onScript === undefined
      ? held
      : scriptId === null
        ? null
        : held?.id === scriptId
          ? held
          : (scripts.data?.find((one) => one.id === scriptId) ?? null);
  const setEditing = (view: PreparedScriptView | null): void => {
    setHeld(view);
    if (view?.id !== editing?.id) onScript?.(view === null ? null : view.id);
  };

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
        <Empty plate art={<ScriptArt />} title="Pas encore de script">
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
            // The page goes to « À copier » itself: no step back through the list in between.
            setHeld(null);
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
