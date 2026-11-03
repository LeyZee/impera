import { CREATOR_TASK_CATEGORY_LABELS, type CreatorAgenda, type CreatorTask } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { AGENDA_KEY, archiveTask } from './api';
import { whenWords } from './words';

import { Dialog } from '@/screens/team/Dialog';
import '@/screens/team/team.css';

/** One of her tasks, opened: what it is, what it is for, and « Retirer » (archived, never deleted). */
export function TaskDialog({
  agenda,
  task,
  day,
  onClose,
}: {
  agenda: CreatorAgenda;
  task: CreatorTask;
  day: string;
  onClose: () => void;
}): JSX.Element {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const done = agenda.ticks.some((tick) => tick.taskId === task.id && tick.day === day);
  const remove = (): void => {
    setBusy(true);
    setFailed(null);
    void archiveTask(task.id).then(async (outcome) => {
      setBusy(false);
      if (outcome.kind === 'failed') {
        setFailed('Pas de réseau : réessaie dans un moment.');
        return;
      }
      await client.invalidateQueries({ queryKey: AGENDA_KEY });
      onClose();
    });
  };
  return (
    <Dialog
      className="ag-scope"
      title={task.title}
      lead={`${CREATOR_TASK_CATEGORY_LABELS[task.category]} · ${whenWords(task.when, agenda.timeZone)}`}
      busy={busy}
      onClose={onClose}
    >
      <div className="tm-dialog__body">
        {task.purpose === null ? null : <p className="ag-explain">{task.purpose}</p>}
        {task.essential ? (
          <p className="ag-explain">
            <span className="ag-ess">essentielle</span> Elle compte pour ta série : coche-la chaque jour
            prévu.
          </p>
        ) : null}
        <p className="tm-hint">{done ? 'Faite ce jour-là.' : 'Pas encore faite ce jour-là.'}</p>
        {failed === null ? null : (
          <p className="tm-hint tm-hint--error" role="alert">
            {failed}
          </p>
        )}
        <div className="tm-dialog__foot">
          {confirm ? (
            <>
              <button
                type="button"
                className="nv-btn nv-btn--plain"
                disabled={busy}
                onClick={() => {
                  setConfirm(false);
                }}
              >
                Garder
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--destructive"
                disabled={busy}
                aria-busy={busy}
                data-autofocus
                onClick={remove}
              >
                Retirer pour de bon
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="nv-btn nv-btn--plain"
                onClick={() => {
                  setConfirm(true);
                }}
              >
                Retirer de mon agenda
              </button>
              <button type="button" className="nv-btn nv-btn--neon" onClick={onClose}>
                OK
              </button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
