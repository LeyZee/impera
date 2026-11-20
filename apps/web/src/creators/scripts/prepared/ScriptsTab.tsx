import type { CreatorId, PreparedScriptView } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type JSX, type ReactNode } from 'react';

import { CopyView } from './CopyView';
import { PreparedEditor } from './PreparedEditor';
import { PreparedList } from './PreparedList';
import { ViewTabs } from './ViewTabs';
import { preparedKey, usePreparedScripts } from './api';
import { NewScriptDialog } from './dialogs';
import { editorMedia, pickerFolders, vaultAccounts } from './media';
import './prepared.css';

import { useVault, useVaultChoices } from '@/creators/vault/api';
import { Empty, Failure } from '@/shell/states';

type View = 'scripts' | 'copy';

/**
 * Créatrices › Scripts (ADR 0149 § 1, ADR 0112 §§ 20-24), the owner's and an active manager's: two views of one tab.
 * « Scripts », her scripts in preparation, « Nouveau script » and the editor; « À copier dans Reveal », what is ready to
 * copy by hand, then what she sent from her phone (`sent`, the screen that was here before).
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
  const client = useQueryClient();
  const scripts = usePreparedScripts(creatorId);
  const vault = useVault(creatorId, false);
  const choices = useVaultChoices(creatorId, false);
  const media = useMemo(() => editorMedia(vault.data, choices.data), [vault.data, choices.data]);
  const folders = useMemo(() => pickerFolders(vault.data), [vault.data]);
  const [view, setView] = useState<View>('scripts');
  const [editing, setEditing] = useState<PreparedScriptView | null>(null);
  const [creating, setCreating] = useState(false);
  const ready = (scripts.data ?? []).filter((one) => one.state === 'ready_to_copy').length;

  const remember = (saved: PreparedScriptView): void => {
    client.setQueryData<readonly PreparedScriptView[]>(preparedKey(creatorId), (before) =>
      before === undefined
        ? [saved]
        : before.some((one) => one.id === saved.id)
          ? before.map((one) => (one.id === saved.id ? saved : one))
          : [saved, ...before],
    );
  };
  const open = (one: PreparedScriptView): void => {
    setEditing(one);
    setView('scripts');
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
    return <PreparedList scripts={scripts.data} onOpen={open} />;
  };

  return (
    <section className="se-page" aria-label={`Scripts de ${creatorName}`}>
      <div className="se-filters">
        <ViewTabs<View>
          label="Vue des scripts"
          value={view}
          onChange={(next) => {
            setView(next);
            setEditing(null);
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
        {view === 'scripts' && editing === null ? (
          <button
            type="button"
            className="nv-btn nv-btn--neon"
            onClick={() => {
              setCreating(true);
            }}
          >
            ＋ Nouveau script
          </button>
        ) : null}
      </div>
      {view === 'copy' ? (
        <>
          <CopyView creatorId={creatorId} scripts={scripts.data ?? []} media={media} onOpen={open} />
          {sent}
        </>
      ) : editing === null ? (
        <>
          <h2 className="nv-h2">Ses scripts</h2>
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
            setView('copy');
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
          accounts={vaultAccounts(vault.data)}
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
