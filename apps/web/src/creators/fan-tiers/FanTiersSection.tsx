import type { CreatorId } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import { Field } from '../persona/fields';

import { StartCapForm } from './StartCapForm';
import { fanTiersKey, saveFanTiers, useFanTiers } from './api';
import { textsOf, TIER_FIELDS, tiersOf, type TierTexts } from './model';
import './fan-tiers.css';

/**
 * Créatrices › Compte › Paliers des fans (Charles, 21/11), the owner's alone: from how much one of her fans is a good
 * payer, a very good one, a whale. The chatter reads the tier beside what the fan spent, on Aujourd'hui and in Suivi.
 * Under the first threshold a fan who bought is « Payeur »; one who never bought is « Nouveau » for seven days. Under
 * them, the cap at a script's start (`StartCapForm`).
 */
export function FanTiersSection({ creatorId }: { creatorId: CreatorId }): JSX.Element | null {
  const read = useFanTiers(creatorId);
  if (read.data === undefined) return null;
  return <TiersForm key={creatorId} creatorId={creatorId} initial={textsOf(read.data)} />;
}

function TiersForm({ creatorId, initial }: { creatorId: CreatorId; initial: TierTexts }): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const [texts, setTexts] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const read = tiersOf(texts);
  const dirty = TIER_FIELDS.some(([key]) => texts[key] !== initial[key]);

  async function save(): Promise<void> {
    if (!('tiers' in read)) return;
    setSaving(true);
    const ok = await saveFanTiers(creatorId, read.tiers);
    setSaving(false);
    setNotice(ok ? 'Paliers enregistrés.' : 'Pas enregistré : réessaie dans un instant.');
    if (ok) await client.invalidateQueries({ queryKey: fanTiersKey(creatorId) });
  }

  return (
    <section className="nv-plate ft-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="nv-h2 ft-title">
        Paliers de ses fans
      </h2>
      <p className="ft-lead">
        Le chatteur voit le palier à côté de ce que le fan a dépensé. Sous le premier montant, un fan qui a
        acheté est « Payeur ».
      </p>
      <form
        className="ft-fields"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {TIER_FIELDS.map(([key, label]) => (
          <Field key={key} label={label} id={`${id}-${key}`}>
            <div className="ft-amount">
              <input
                id={`${id}-${key}`}
                className="nv-glass nv-field__control ps-input"
                inputMode="decimal"
                autoComplete="off"
                value={texts[key]}
                disabled={saving}
                onChange={(event) => {
                  setTexts({ ...texts, [key]: event.target.value });
                  setNotice(null);
                }}
              />
              <span className="ft-unit" aria-hidden="true">
                €
              </span>
            </div>
          </Field>
        ))}
        {'problem' in read && dirty ? (
          <p className="ft-problem" role="alert">
            {read.problem}
          </p>
        ) : null}
        <div className="ft-actions">
          <button
            type="submit"
            className="nv-btn nv-btn--neon"
            disabled={!dirty || saving || !('tiers' in read)}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          {notice === null ? null : (
            <span className="ft-notice" role="status">
              {notice}
            </span>
          )}
        </div>
      </form>
      <StartCapForm creatorId={creatorId} />
    </section>
  );
}
