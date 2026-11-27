import type { CreatorId } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import { Field } from '../persona/fields';

import { saveStartCap, startCapKey, useStartCap } from './api';
import { startCapOf, startCapTextOf } from './model';

import { MONEY_LEAD, useConfirmAgain } from '@/settings/services/ConfirmAgain';

/**
 * Créatrices › Compte › Paliers de ses fans › Plafond au lancement (ADR 0098, avenant du 27/11/2026), the owner's
 * alone: at a script's start, its first paid step costs at most this multiple of the biggest purchase the fan made.
 * Empty, no cap. Money: the server asks for the password and the code again, and the change waits for them.
 */
export function StartCapForm({ creatorId }: { creatorId: CreatorId }): JSX.Element | null {
  const read = useStartCap(creatorId);
  if (read.data === undefined) return null;
  return <CapForm key={creatorId} creatorId={creatorId} initial={startCapTextOf(read.data)} />;
}

function CapForm({ creatorId, initial }: { creatorId: CreatorId; initial: string }): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const confirm = useConfirmAgain();
  const [text, setText] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const read = startCapOf(text);
  const dirty = text !== initial;

  async function save(): Promise<void> {
    if (!('setting' in read)) return;
    setSaving(true);
    const outcome = await saveStartCap(creatorId, read.setting);
    setSaving(false);
    if (outcome === 'reauth') {
      confirm.ask(() => {
        void save();
      });
      return;
    }
    setNotice(outcome === 'ok' ? 'Plafond enregistré.' : 'Pas enregistré : réessaie dans un instant.');
    if (outcome === 'ok') await client.invalidateQueries({ queryKey: startCapKey(creatorId) });
  }

  const prompt = confirm.prompt({ lead: MONEY_LEAD, layout: 'inline', onBusyChange: setSaving });
  return (
    <div className="ft-cap">
      <form
        className="ft-fields"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field
          label="Plafond au lancement"
          id={`${id}-cap`}
          hint="Au lancement d’un script, sa première étape payante ne dépasse pas ce multiple du plus gros achat que le fan a pris. Par exemple 1,2 : pour un plus gros achat de 20 €, 24 € au plus. Vide : pas de plafond."
        >
          <div className="ft-amount">
            <input
              id={`${id}-cap`}
              className="nv-glass nv-field__control ps-input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Pas de plafond"
              value={text}
              disabled={saving || prompt !== null}
              aria-invalid={'problem' in read && dirty}
              onChange={(event) => {
                setText(event.target.value);
                setNotice(null);
              }}
            />
            <span className="ft-unit" aria-hidden="true">
              ×
            </span>
          </div>
        </Field>
        {'problem' in read && dirty ? (
          <p className="ft-problem" role="alert">
            {read.problem}
          </p>
        ) : null}
        {prompt === null ? (
          <div className="ft-actions">
            <button
              type="submit"
              className="nv-btn nv-btn--neon"
              disabled={!dirty || saving || !('setting' in read)}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer le plafond'}
            </button>
            {notice === null ? null : (
              <span className="ft-notice" role="status">
                {notice}
              </span>
            )}
          </div>
        ) : null}
      </form>
      {/* Outside the form: its « Confirmer » must not submit the cap a second time. */}
      {prompt}
    </div>
  );
}
