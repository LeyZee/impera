import type { PlaygroundState } from '@nirvana/contracts';
import { useEffect, useState, type JSX } from 'react';

import { clockAt, duration, money, scriptsHint } from './logic';
import type { CreatorMedia as CreatorMediaInput, MediaKind } from './model';
import type { Playground } from './usePlayground';

export const MEDIA_KINDS: readonly { kind: MediaKind; label: string }[] = [
  { kind: 'image', label: 'Photo' },
  { kind: 'video', label: 'Vidéo' },
  { kind: 'audio', label: 'Vocal' },
];

/**
 * Who the fan is, what we know of him, what time it is for her, and what she can send. Only the fan stays
 * open: the rest folds to one line that says what it holds (docs/design/README.md, « Hiérarchie »).
 */
export function SetupPanel({
  state,
  pg,
  sheetOpen,
  onCloseSheet,
}: {
  state: PlaygroundState;
  pg: Playground;
  /** On a phone the panel is a sheet, opened from the conversation's « Fan » button. */
  sheetOpen: boolean;
  onCloseSheet: () => void;
}): JSX.Element {
  const { situation } = state;
  const age = new Date(situation.now).getTime() - new Date(situation.relationshipStartedAt).getTime();
  const known = [
    ...state.fanNotes.slice(0, 2),
    situation.spentCents === 0 ? 'jamais acheté' : `${money(situation.spentCents)} dépensés`,
  ].join(' · ');

  return (
    <aside
      id="pg-setup"
      className={`pg-setup nv-plate ${sheetOpen ? 'is-sheet nv-glass nv-glass--thick' : ''}`}
      aria-label="Mise en situation"
    >
      <div className="pg-setup__h">
        <b>Mise en situation</b>
        <button type="button" className="nv-close" aria-label="Fermer" onClick={onCloseSheet}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="nv-scroll">
        <FanPicker state={state} pg={pg} onPicked={onCloseSheet} />

        <details className="nv-disclosure pg-fold">
          <summary>
            <span className="nv-disclosure__title">Ce qu’on sait</span>
            <span className="nv-disclosure__sum">{known}</span>
          </summary>
          <div className="nv-disclosure__body">
            <Notes
              key={state.presetId}
              notes={state.fanNotes}
              onSave={(notes) => void pg.run((c) => c.setNotes(notes))}
            />
            <Spent
              key={`${state.presetId ?? ''}-spent`}
              cents={situation.spentCents}
              onSave={(cents) => void pg.run((c) => c.setSpent(cents))}
            />
          </div>
        </details>

        <details className="nv-disclosure pg-fold">
          <summary>
            <span className="nv-disclosure__title">Le moment</span>
            <span className="nv-disclosure__sum">
              {clockAt(situation.now, situation.timeZone)}, {situation.isNight ? 'Nuit' : 'Jour'} ·{' '}
              {/* Kept on one line when the summary wraps. */}
              {`relation de ${duration(age)}`.replaceAll(' ', '\u00a0')}
            </span>
          </summary>
          <div className="nv-disclosure__body">
            <div className="pg-clock">
              <span className="pg-clock__c">
                <span>Chez elle</span>
                <b>
                  {clockAt(situation.now, situation.timeZone)}
                  <span className="pg-moon">{situation.isNight ? '🌙 Nuit' : '☀️ Jour'}</span>
                </b>
              </span>
              <span className="pg-clock__c">
                <span>Relation</span>
                <b>{duration(age)}</b>
              </span>
            </div>
            <p className="pg-hint">{scriptsHint(situation.isNight)}</p>
            <div className="pg-row2">
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm"
                disabled={pg.busy}
                onClick={() => void pg.run((c) => c.advance(1))}
              >
                +1 h
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm"
                disabled={pg.busy}
                onClick={() => void pg.run((c) => c.advance(24))}
              >
                +1 jour
              </button>
            </div>
          </div>
        </details>

        <details className="nv-disclosure pg-fold">
          <summary>
            <span className="nv-disclosure__title">Elle envoie</span>
            <span className="nv-disclosure__sum">une photo, une vidéo…</span>
          </summary>
          <div className="nv-disclosure__body">
            <CreatorMedia
              disabled={pg.busy}
              onSend={(media) => void pg.run((c) => c.sendCreatorMedia(media))}
            />
          </div>
        </details>
      </div>
    </aside>
  );
}

/** The fan being played, always visible; the other types unfold only to change. */
function FanPicker({
  state,
  pg,
  onPicked,
}: {
  state: PlaygroundState;
  pg: Playground;
  onPicked: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const preset = state.presets.find((p) => p.id === state.presetId);
  return (
    <section className="pg-fan">
      <p className="nv-eyebrow">Le fan</p>
      <button
        type="button"
        className="pg-fan__now nv-tap"
        aria-expanded={open}
        aria-controls="pg-fan-list"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span className="pg-fan__t">
          <b>{preset?.label ?? 'Fan libre'}</b>
          <span>{preset === undefined ? 'Aucun profil' : `Teste ${preset.tests}`}</span>
        </span>
        <span className="pg-fan__c">{open ? 'Fermer' : 'Changer'}</span>
      </button>
      {open ? (
        <div className="pg-fan__list" id="pg-fan-list" role="radiogroup" aria-label="Type de fan">
          {state.presets
            .filter((p) => p.id !== state.presetId)
            .map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={false}
                className="pg-fan__opt nv-tap"
                style={{ animationDelay: `${String(i * 25)}ms` }}
                disabled={pg.busy}
                onClick={() => {
                  setOpen(false);
                  onPicked();
                  void pg.run((c) => c.choosePreset(p.id));
                }}
              >
                {p.label}
                {/* What it tests is what one picks a scenario by: said in full, not on hover (no hover on a phone). */}
                <span className="pg-fan__optt">Teste {p.tests}</span>
              </button>
            ))}
        </div>
      ) : null}
    </section>
  );
}

/** One fact per line, saved when the field loses focus (canevas: Prénom, Localisation, Âge, Métier…). */
function Notes({
  notes,
  onSave,
}: {
  notes: readonly string[];
  onSave: (notes: string[]) => void;
}): JSX.Element {
  const [text, setText] = useState(notes.join('\n'));
  useEffect(() => {
    setText(notes.join('\n'));
  }, [notes]);
  return (
    <label className="pg-field">
      <span className="sr-only">Notes du fan, une par ligne</span>
      <textarea
        className="pg-notes"
        rows={Math.max(3, notes.length + 1)}
        value={text}
        placeholder={'Prénom : …\nMétier : …\nLocalisation : …'}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onBlur={() => {
          const next = text
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line !== '');
          if (next.join('\n') !== notes.join('\n')) onSave(next);
        }}
      />
    </label>
  );
}

function Spent({ cents, onSave }: { cents: number; onSave: (cents: number) => void }): JSX.Element {
  const [value, setValue] = useState(String(cents / 100));
  return (
    <label className="pg-spent">
      <span>Déjà dépensé</span>
      <span className="pg-spent__in">
        <input
          inputMode="decimal"
          value={value}
          aria-label="Montant déjà dépensé, en euros"
          onChange={(event) => {
            setValue(event.target.value);
          }}
          onBlur={() => {
            const next = Math.round(Number(value.replace(',', '.')) * 100);
            if (Number.isFinite(next) && next >= 0 && next !== cents) onSave(next);
            else setValue(String(cents / 100));
          }}
        />
        €
      </span>
      <span className="pg-spent__v">{cents === 0 ? 'jamais acheté' : money(cents)}</span>
    </label>
  );
}

function CreatorMedia({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (media: CreatorMediaInput) => void;
}): JSX.Element {
  const [kind, setKind] = useState<MediaKind>('image');
  const [text, setText] = useState('');
  const [isLocked, setLocked] = useState(true);
  return (
    <form
      className="pg-cmedia"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() === '') return;
        onSend({ kind, factualDescription: text.trim(), isLocked });
        setText('');
      }}
    >
      <div className="pg-kinds" role="radiogroup" aria-label="Type de média">
        {MEDIA_KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="radio"
            aria-checked={k.kind === kind}
            className="nv-chip"
            onClick={() => {
              setKind(k.kind);
            }}
          >
            {k.label}
          </button>
        ))}
      </div>
      <input
        className="pg-input"
        value={text}
        placeholder="Ce qu’on y voit : tenue, lieu, action"
        aria-label="Ce qu’on voit dans son média"
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <label className="pg-switch">
        <input
          type="checkbox"
          className="nv-switch"
          checked={isLocked}
          onChange={(event) => {
            setLocked(event.target.checked);
          }}
        />
        Payant, flouté
      </label>
      <button
        type="submit"
        className="nv-btn nv-btn--soft nv-btn--sm"
        disabled={disabled || text.trim() === ''}
      >
        Faire envoyer par elle
      </button>
    </form>
  );
}
