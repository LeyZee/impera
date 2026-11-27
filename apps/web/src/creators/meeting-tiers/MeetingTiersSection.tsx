import type { CreatorId, MeetingTierSettings } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import { Field } from '../persona/fields';

import { meetingTiersKey, saveMeetingTiers, useMeetingTiers } from './api';
import { MEETING_TIER_FIELDS, meetingTiersOf, textsOf, type MeetingTierTexts } from './model';
import '../fan-tiers/fan-tiers.css';

/**
 * Créatrices › Compte › Paliers de rencontre (guide 26/11), the owner's alone, beside the tiers of her fans: after how
 * many hours a fan who asks to see her is no longer new, then, if he paid, close and very close. The agent picks its
 * reason from that tier; without these durations no fan goes past the second. No value is suggested: he types them.
 */
export function MeetingTiersSection({ creatorId }: { creatorId: CreatorId }): JSX.Element | null {
  const read = useMeetingTiers(creatorId);
  if (read.data === undefined) return null;
  return <MeetingTiersForm key={creatorId} creatorId={creatorId} stored={read.data} />;
}

function MeetingTiersForm({
  creatorId,
  stored,
}: {
  creatorId: CreatorId;
  stored: MeetingTierSettings | null;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const initial: MeetingTierTexts = textsOf(stored);
  const [texts, setTexts] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const read = meetingTiersOf(texts);
  const dirty = MEETING_TIER_FIELDS.some(([key]) => texts[key] !== initial[key]);

  async function save(): Promise<void> {
    if (!('settings' in read)) return;
    setSaving(true);
    const ok = await saveMeetingTiers(creatorId, read.settings);
    setSaving(false);
    setNotice(ok ? 'Paliers de rencontre enregistrés.' : 'Pas enregistré : réessaie dans un instant.');
    if (ok) await client.invalidateQueries({ queryKey: meetingTiersKey(creatorId) });
  }

  return (
    <section className="nv-plate ft-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="nv-h2 ft-title">
        Paliers de rencontre
      </h2>
      <p className="ft-lead">
        Quand un fan demande à la voir, l’agent répond selon où ils en sont. Proche et très proche : seulement
        s’il a payé. Vides, aucun fan ne dépasse le deuxième palier.
      </p>
      <form
        className="ft-fields"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {MEETING_TIER_FIELDS.map(([key, label]) => (
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
                h
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
            disabled={!dirty || saving || !('settings' in read)}
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
    </section>
  );
}
