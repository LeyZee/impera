import type { CreatorId, MeetingTierSettings } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import { Field, Segment } from '../persona/fields';

import { meetingTiersKey, saveMeetingTiers, useMeetingTiers } from './api';
import {
  MEETING_TIER_FIELDS,
  meetingTiersOf,
  sameTexts,
  textsOf,
  UNIT_OPTIONS,
  type MeetingTierTexts,
} from './model';
import '../fan-tiers/fan-tiers.css';
import './meeting-tiers.css';

/**
 * Créatrices › Compte › Paliers de rencontre (guide 26/11), the owner's alone, beside the tiers of her fans: after how
 * long a fan who asks to see her is no longer new, then, if he paid, close and very close. Typed in days, weeks or
 * months (Charles, 27/11), stored in hours. The agent picks its reason from that tier; without these durations no fan
 * goes past the second. No value is suggested: he types them.
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
  const dirty = !sameTexts(texts, initial);

  async function save(): Promise<void> {
    if (!('settings' in read)) return;
    setSaving(true);
    const ok = await saveMeetingTiers(creatorId, read.settings);
    setSaving(false);
    setNotice(ok ? 'Paliers de rencontre enregistrés.' : 'Pas enregistré : réessaie dans un instant.');
    if (!ok) return;
    // Shown as they will read back: the largest unit each falls on exactly.
    setTexts(textsOf(read.settings));
    await client.invalidateQueries({ queryKey: meetingTiersKey(creatorId) });
  }

  return (
    <section className="nv-plate ft-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="nv-h2 ft-title">
        Paliers de rencontre
      </h2>
      <p className="ft-lead">
        Quand un fan demande à la voir, l’agent répond selon son palier : nouveau, quelques jours, proche,
        très proche. Les durées sont comptées depuis le premier message échangé avec lui (une semaine fait 7
        jours, un mois 30 jours). Proche et très proche demandent qu’il ait payé. Sans ces durées, aucun fan
        ne dépasse « quelques jours ».
      </p>
      <form
        className="ft-fields mt-fields"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {MEETING_TIER_FIELDS.map(([key, label]) => (
          <Field key={key} label={label} id={`${id}-${key}`}>
            <div className="mt-duration">
              <input
                id={`${id}-${key}`}
                className="nv-glass nv-field__control ps-input mt-amount"
                inputMode="decimal"
                autoComplete="off"
                value={texts[key].amount}
                disabled={saving}
                onChange={(event) => {
                  setTexts({ ...texts, [key]: { ...texts[key], amount: event.target.value } });
                  setNotice(null);
                }}
              />
              <Segment
                label={`Unité : ${label}`}
                options={UNIT_OPTIONS}
                value={texts[key].unit}
                onChange={(unit) => {
                  setTexts({ ...texts, [key]: { ...texts[key], unit } });
                  setNotice(null);
                }}
              />
            </div>
          </Field>
        ))}
        {stored === null && !dirty ? <p className="mt-unset">Pas encore réglé</p> : null}
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
