import { LEVEL_RANKS, type LevelSettings } from '@impera/contracts';
import { useState, type JSX } from 'react';

import { LevelInsignia } from './LevelInsignia';
import { useLevelSettings, useSaveLevelThresholds } from './api';
import './rewards.css';

import { amountInput, amountText, parseAmount } from '@/reports/model';
import { Dialog } from '@/shell/Dialog';
import { Panel } from '@/shell/layout';

/** The highest threshold a rank may ask (`LevelThresholdsSchema`). */
const THRESHOLD_MAX_MINOR = 1_000_000_000;

/**
 * What the fields say, read as thresholds: the ranks filled from the first, each above the one before. `null` when a
 * field does not read as an amount above zero, a rank is filled after an empty one, or the order is broken.
 */
export function thresholdsTyped(fields: readonly string[]): number[] | null {
  const last = fields.findLastIndex((field) => field.trim() !== '');
  const typed = fields.slice(0, last + 1).map((field) => parseAmount(field, false, THRESHOLD_MAX_MINOR));
  const values: number[] = [];
  for (const value of typed) {
    if (value === null || value < 1 || value <= (values.at(-1) ?? 0)) return null;
    values.push(value);
  }
  return values;
}

/**
 * Paie › Objectifs › « Rangs des chatteurs » (ADR 0104 § 16): the owner sets the cumulated net that opens each rank;
 * the ranks, their names and their insignia are the game's. Honorary: no rate, tier or right hangs on a rank, and a
 * rank reached is never taken back. The owner's alone: a manager does not see the card.
 */
export function LevelsPanel(): JSX.Element | null {
  const settings = useLevelSettings(true);
  const [editing, setEditing] = useState(false);
  if (settings.data === undefined) return null;
  const { ranks, thresholdsMinor } = settings.data;
  return (
    <Panel
      className="nv-enter rw-levels"
      eyebrow="Rangs des chatteurs"
      title={thresholdsMinor.length === 0 ? 'Aucun seuil réglé' : 'Net cumulé qui ouvre chaque rang'}
      actions={
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm"
          onClick={() => {
            setEditing(true);
          }}
        >
          Régler les seuils
        </button>
      }
    >
      <div className="rp-sec">
        <ul className="rw-levels__list">
          {ranks.map((rank, index) => {
            const threshold = thresholdsMinor[index];
            return (
              <li key={rank.rank} className="rw-levels__rank" data-open={threshold !== undefined}>
                <LevelInsignia rank={rank.rank} earned={threshold !== undefined} size={44} />
                <p className="rw-levels__name">{rank.name}</p>
                <p className="rw-levels__at nv-num">
                  {threshold === undefined ? 'Pas de seuil' : `à ${amountText(threshold, 'EUR')}`}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="py-quiet">
          {thresholdsMinor.length === 0
            ? 'Sans seuil, aucun chatteur n’a de rang. '
            : 'Un rang sans seuil reste fermé. '}
          Un rang est honorifique : il ne change ni un taux, ni un palier, ni la paie, et un rang atteint ne
          se reprend pas.
        </p>
      </div>
      {editing ? (
        <LevelsDialog
          settings={settings.data}
          onClose={() => {
            setEditing(false);
          }}
        />
      ) : null}
    </Panel>
  );
}

function LevelsDialog({ settings, onClose }: { settings: LevelSettings; onClose: () => void }): JSX.Element {
  const save = useSaveLevelThresholds();
  const [fields, setFields] = useState<string[]>(() =>
    Array.from({ length: LEVEL_RANKS }, (_, index) => {
      const value = settings.thresholdsMinor[index];
      return value === undefined ? '' : amountInput(value);
    }),
  );
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const typed = thresholdsTyped(fields);

  const send = async (): Promise<void> => {
    setTouched(true);
    if (typed === null || busy) return;
    setBusy(true);
    setFailed(false);
    const saved = await save(typed);
    setBusy(false);
    if (saved) onClose();
    else setFailed(true);
  };

  return (
    <Dialog
      className="py-dialog"
      title="Seuils des rangs"
      lead="Le net cumulé d’un chatteur, depuis son arrivée, qui ouvre chaque rang."
      busy={busy}
      onClose={onClose}
    >
      <form
        className="tm-dialog__body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <ul className="rw-levelform">
          {settings.ranks.map((rank, index) => (
            <li key={rank.rank} className="rw-levelform__row">
              <LevelInsignia rank={rank.rank} size={44} />
              <span className="rw-levelform__name">{rank.name}</span>
              <span className="py-tierrow__field">
                <input
                  className="nv-field__control nv-glass nv-num"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={`Net cumulé pour le rang ${rank.name}`}
                  aria-invalid={touched && typed === null}
                  value={fields[index] ?? ''}
                  onChange={(event) => {
                    setFields(fields.map((one, at) => (at === index ? event.target.value : one)));
                  }}
                />
                <span className="py-tierrow__suffix" aria-hidden="true">
                  €
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className={touched && typed === null ? 'tm-hint tm-hint--error' : 'tm-hint'}>
          {touched && typed === null
            ? 'Chaque seuil est un montant en euros, plus haut que le précédent, sans rang vide au milieu.'
            : 'Le seuil est compris. Laisse vides les rangs du haut pour les garder fermés. Monter un seuil ne reprend pas un rang déjà atteint.'}
        </p>
        {failed ? (
          <p className="tm-warn nv-swap" role="alert">
            Les seuils n’ont pas été enregistrés : le serveur ne répond pas.
          </p>
        ) : null}
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer les seuils'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
