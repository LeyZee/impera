import type { CreatorId } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import '../fan-tiers/fan-tiers.css';
import { Field } from '../persona/fields';

import { saveStaircase, staircaseKey, useStaircase } from './api';
import { settingOf, STAIRCASE_FIELDS, textsOf, type StaircaseTexts } from './model';

/**
 * Créatrices › Compte › Escalier des prix (ADR 0098, avenant du 27/11/2026), the owner's alone: the agency's multiples
 * for her scripts' paid steps. Empty until he sets them; a field left empty turns its part off. Whatever is set, each
 * paid step he is offered costs more than the last one he bought.
 */
export function StaircaseSection({ creatorId }: { creatorId: CreatorId }): JSX.Element | null {
  const read = useStaircase(creatorId);
  if (read.data === undefined) return null;
  return <StaircaseForm key={creatorId} creatorId={creatorId} initial={textsOf(read.data)} />;
}

function StaircaseForm({
  creatorId,
  initial,
}: {
  creatorId: CreatorId;
  initial: StaircaseTexts;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const [texts, setTexts] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const read = settingOf(texts);
  const dirty = STAIRCASE_FIELDS.some(([key]) => texts[key] !== initial[key]);

  async function save(): Promise<void> {
    if (!('setting' in read)) return;
    setSaving(true);
    const ok = await saveStaircase(creatorId, read.setting);
    setSaving(false);
    setNotice(ok ? 'Réglages enregistrés.' : 'Pas enregistré : réessaie dans un instant.');
    if (ok) await client.invalidateQueries({ queryKey: staircaseKey(creatorId) });
  }

  return (
    <section className="nv-plate ft-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="nv-h2 ft-title">
        Escalier des prix des scripts
      </h2>
      <p className="ft-lead">
        Chaque étape payante proposée coûte toujours plus que la dernière qu’il a prise. Ces réglages ajoutent
        le reste ; un champ vide coupe sa partie.
      </p>
      <form
        className="ft-fields"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {STAIRCASE_FIELDS.map(([key, label]) => (
          <Field key={key} label={label} id={`${id}-${key}`}>
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
            disabled={!dirty || saving || !('setting' in read)}
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
