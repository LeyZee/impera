import {
  AUDIO_SLOT_SECONDS_MAX,
  BRIDGE_MEDIA_SLOTS_MAX,
  MEDIA_SLOT_HINT_MAX,
  MEDIA_SLOTS_MAX,
  SCRIPT_SENTENCE_MAX,
  SCRIPT_STAGE_NAME_MAX,
  VIDEO_SLOT_SECONDS_MAX,
  type MediaSlot,
  type ScriptSegment,
  type ScriptStage,
  type ScriptVariantLetter,
} from '@impera/contracts';
import { useId, type JSX } from 'react';

import { ScIcon } from './icons';
import { nextLetter, photo, slotsSummary, video, voice } from './model';

import { Field, Segment, TextArea, TextInput } from '@/creators/persona/fields';

const KIND_LABELS = { image: 'Photo', video: 'Vidéo', audio: 'Vocal' } as const;
const PLACEHOLDERS = {
  image: 'De dos, en lingerie…',
  video: 'Plan large, elle se retourne…',
  audio: 'Chuchoté, tout près du micro…',
} as const;
const KINDS = ['image', 'video', 'audio'] as const;
/** « la photo 2 », « le vocal 1 »: the words of the labels a screen reader says. */
const THE = { image: 'la photo', video: 'la vidéo', audio: 'le vocal' } as const;
const OF_THE = { image: 'de la photo', video: 'de la vidéo', audio: 'du vocal' } as const;
const A = { image: 'une photo', video: 'une vidéo', audio: 'un vocal' } as const;

/** What a segment has to shoot, as small counted icons; the words stay for screen readers. */
export function Counts({ slots }: { slots: readonly MediaSlot[] }): JSX.Element {
  if (slots.length === 0) return <span className="st-counts st-counts--none">Rien à tourner</span>;
  return (
    <span className="st-counts">
      <span className="sr-only">{slotsSummary(slots)}</span>
      {KINDS.map((kind) => {
        const n = slots.filter((slot) => slot.kind === kind).length;
        return n === 0 ? null : (
          <span key={kind} className="st-count" aria-hidden="true">
            <ScIcon name={kind} size={14} />
            {n}
          </span>
        );
      })}
    </span>
  );
}

/** An empty field is « rien » for the optional sentences: `null`, never an empty string the contract refuses. */
const orNull = (value: string): string | null => (value.trim() === '' ? null : value);

/**
 * The sheet of one segment of the stack: a stage (what it sells, offered or paid, mood, outfit, place, what to shoot,
 * its series) or a bridge (its teaser and its teaser photo). Every change goes up whole; the stack keeps the order.
 */
export function SegmentEditor({
  segment,
  title,
  variant,
  onVariant,
  onChange,
}: {
  segment: ScriptSegment;
  /** « Étape 2 », « Pont 2 & 3 ». */
  title: string;
  variant: ScriptVariantLetter | null;
  onVariant: (letter: ScriptVariantLetter | null) => void;
  onChange: (next: ScriptSegment) => void;
}): JSX.Element {
  const id = useId();
  if (segment.kind === 'bridge') {
    return (
      <div className="ps-block st-sheet">
        <header className="st-sheet__head">
          <span className="st-sheet__eyebrow">{title}</span>
          <h2 className="st-sheet__title">Le pont</h2>
          <p className="ps-muted">
            Toujours offert : il fait comprendre au fan ce qui vient ensuite, avec une photo teasing.
          </p>
        </header>
        <Field label="Teaser" id={`${id}-teaser`} hint="Ce que le pont fait attendre, en une phrase.">
          <TextArea
            id={`${id}-teaser`}
            value={segment.teaser}
            maxLength={SCRIPT_SENTENCE_MAX}
            rows={2}
            onChange={(teaser) => {
              onChange({ ...segment, teaser });
            }}
          />
        </Field>
        <Slots
          slots={segment.mediaSlots}
          max={BRIDGE_MEDIA_SLOTS_MAX}
          onChange={(mediaSlots) => {
            onChange({ ...segment, mediaSlots });
          }}
        />
      </div>
    );
  }
  return (
    <div className="ps-block st-sheet">
      <header className="st-sheet__head">
        <span className="st-sheet__eyebrow">{title}</span>
        <h2 className="st-sheet__title">{segment.name.trim() === '' ? 'Sans nom' : segment.name}</h2>
      </header>
      <h3 className="st-group__title">L’essentiel</h3>
      <div className="st-grid">
        <Field label="Nom de l’étape" id={`${id}-name`}>
          <TextInput
            id={`${id}-name`}
            value={segment.name}
            maxLength={SCRIPT_STAGE_NAME_MAX}
            invalid={segment.name.trim() === ''}
            onChange={(name) => {
              onChange({ ...segment, name });
            }}
          />
        </Field>
        <Field label="Accès" hint="Ce que dit le carton, jamais un prix.">
          <Segment
            label="Accès"
            value={segment.access}
            options={[
              { value: 'free', label: 'Gratuit' },
              { value: 'paid', label: 'Payant' },
            ]}
            onChange={(access) => {
              onChange({ ...segment, access });
            }}
          />
        </Field>
      </div>
      <Field
        label="Intention"
        id={`${id}-intention`}
        hint="Ce que l’étape fait comprendre au fan, en une phrase."
      >
        <TextArea
          id={`${id}-intention`}
          value={segment.intention}
          maxLength={SCRIPT_SENTENCE_MAX}
          rows={2}
          invalid={segment.intention.trim() === ''}
          onChange={(intention) => {
            onChange({ ...segment, intention });
          }}
        />
      </Field>
      <h3 className="st-group__title">Le tournage</h3>
      <div className="st-grid st-grid--three">
        <Field label="Ambiance" id={`${id}-mood`}>
          <TextInput
            id={`${id}-mood`}
            value={segment.mood ?? ''}
            maxLength={SCRIPT_SENTENCE_MAX}
            example="Lumière tamisée, regard joueur"
            onChange={(mood) => {
              onChange({ ...segment, mood: orNull(mood) });
            }}
          />
        </Field>
        <Field label="Tenue" id={`${id}-outfit`} hint="Le mode tournage regroupe les étapes par tenue.">
          <TextInput
            id={`${id}-outfit`}
            value={segment.outfit ?? ''}
            maxLength={SCRIPT_STAGE_NAME_MAX}
            example="Lingerie noire"
            onChange={(outfit) => {
              onChange({ ...segment, outfit: orNull(outfit) });
            }}
          />
        </Field>
        <Field label="Lieu" id={`${id}-place`} hint="Puis par lieu, pour tout tourner d’affilée.">
          <TextInput
            id={`${id}-place`}
            value={segment.place ?? ''}
            maxLength={SCRIPT_STAGE_NAME_MAX}
            example="Chambre"
            onChange={(place) => {
              onChange({ ...segment, place: orNull(place) });
            }}
          />
        </Field>
      </div>
      <Slots
        slots={segment.mediaSlots}
        max={MEDIA_SLOTS_MAX}
        onChange={(mediaSlots) => {
          onChange({ ...segment, mediaSlots });
        }}
      />
      <Series stage={segment} variant={variant} onVariant={onVariant} onChange={onChange} />
    </div>
  );
}

/** What to shoot, one row per frame, in the order the card lists them. */
function Slots({
  slots,
  max,
  onChange,
}: {
  slots: readonly MediaSlot[];
  max: number;
  onChange: (slots: MediaSlot[]) => void;
}): JSX.Element {
  const id = useId();
  const set = (index: number, slot: MediaSlot): void => {
    onChange(slots.map((current, at) => (at === index ? slot : current)));
  };
  const full = slots.length >= max;
  return (
    <fieldset className="st-fieldset">
      <legend className="st-group__title">À tourner</legend>
      {slots.length === 0 ? <p className="ps-muted">Rien à tourner pour l’instant.</p> : null}
      <ol className="st-slots">
        {slots.map((slot, index) => {
          const n = String(index + 1);
          return (
            // A frame has no id of its own: its place in the list is it.
            <li key={index} className="st-slot" data-kind={slot.kind} data-optional={slot.optional}>
              <span className="st-slot__kind">
                <ScIcon name={slot.kind} />
                {KIND_LABELS[slot.kind]}
              </span>
              <input
                className="nv-glass nv-field__control ps-input st-slot__hint"
                aria-label={`Indication ${OF_THE[slot.kind]} ${n}`}
                placeholder={PLACEHOLDERS[slot.kind]}
                maxLength={MEDIA_SLOT_HINT_MAX}
                value={slot.hint ?? ''}
                onChange={(event) => {
                  set(index, { ...slot, hint: orNull(event.target.value) });
                }}
              />
              <button
                type="button"
                className="st-pill st-slot__optional"
                aria-pressed={slot.optional}
                title="Une prise facultative peut manquer sans bloquer le dépôt."
                onClick={() => {
                  set(index, { ...slot, optional: !slot.optional });
                }}
              >
                Facultative
              </button>
              <button
                type="button"
                className="st-tool st-tool--danger st-slot__remove"
                aria-label={`Retirer ${THE[slot.kind]} ${n}`}
                title="Retirer"
                onClick={() => {
                  onChange(slots.filter((_, at) => at !== index));
                }}
              >
                <ScIcon name="close" />
              </button>
              {slot.kind === 'video' ? (
                <span className="st-slot__length">
                  Durée
                  <Seconds
                    label={`Durée minimale de la vidéo ${String(index + 1)}`}
                    value={slot.minSeconds}
                    max={VIDEO_SLOT_SECONDS_MAX}
                    onChange={(minSeconds) => {
                      set(index, { ...slot, minSeconds });
                    }}
                  />
                  <span aria-hidden="true">à</span>
                  <Seconds
                    label={`Durée maximale de la vidéo ${String(index + 1)}`}
                    value={slot.maxSeconds}
                    max={VIDEO_SLOT_SECONDS_MAX}
                    onChange={(maxSeconds) => {
                      set(index, { ...slot, maxSeconds });
                    }}
                  />
                  <span aria-hidden="true">secondes</span>
                </span>
              ) : slot.kind === 'audio' ? (
                <span className="st-slot__length">
                  Jusqu’à
                  <Seconds
                    label={`Durée maximale du vocal ${String(index + 1)}`}
                    value={slot.maxSeconds}
                    max={AUDIO_SLOT_SECONDS_MAX}
                    onChange={(maxSeconds) => {
                      set(index, { ...slot, maxSeconds });
                    }}
                  />
                  <span aria-hidden="true">secondes</span>
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="st-actions" aria-describedby={full ? `${id}-full` : undefined}>
        {(
          [
            ['Photo', photo],
            ['Vidéo', video],
            ['Vocal', voice],
          ] as const
        ).map(([label, make]) => (
          <button
            key={label}
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm st-add"
            aria-label={`Ajouter ${A[make().kind]}`}
            disabled={full}
            onClick={() => {
              onChange([...slots, make()]);
            }}
          >
            <ScIcon name={make().kind} size={15} />
            {label}
          </button>
        ))}
        {full ? (
          <span className="ps-hint" id={`${id}-full`}>
            {`${String(max)} au plus.`}
          </span>
        ) : null}
      </div>
    </fieldset>
  );
}

function Seconds({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <input
      type="number"
      inputMode="numeric"
      className="nv-glass nv-field__control ps-input st-seconds"
      aria-label={label}
      min={1}
      max={max}
      value={Number.isNaN(value) ? '' : value}
      onChange={(event) => {
        onChange(event.target.value === '' ? Number.NaN : Math.round(Number(event.target.value)));
      }}
    />
  );
}

/** The series of a stage: other takes of the same frames, A, B, C, each with what differs. */
function Series({
  stage,
  variant,
  onVariant,
  onChange,
}: {
  stage: ScriptStage;
  variant: ScriptVariantLetter | null;
  onVariant: (letter: ScriptVariantLetter | null) => void;
  onChange: (next: ScriptStage) => void;
}): JSX.Element {
  const letter = nextLetter(stage);
  return (
    <fieldset className="st-fieldset">
      <legend className="st-group__title">Séries</legend>
      <p className="ps-hint">
        Les mêmes médias tournés autrement : chaque série a son carton, avec sa pastille en pied.
      </p>
      <ul className="st-series">
        {stage.variants.map((series) => (
          <li key={series.letter} className="st-series__row">
            <button
              type="button"
              className="nv-chip st-series__letter"
              aria-pressed={variant === series.letter}
              aria-label={`Voir le carton de la série ${series.letter}`}
              onClick={() => {
                onVariant(variant === series.letter ? null : series.letter);
              }}
            >
              {series.letter}
            </button>
            <input
              className="nv-glass nv-field__control ps-input"
              aria-label={`Consigne de la série ${series.letter}`}
              maxLength={SCRIPT_SENTENCE_MAX}
              aria-invalid={series.hint.trim() === '' ? true : undefined}
              value={series.hint}
              onChange={(event) => {
                onChange({
                  ...stage,
                  variants: stage.variants.map((v) =>
                    v.letter === series.letter ? { ...v, hint: event.target.value } : v,
                  ),
                });
              }}
            />
            <button
              type="button"
              className="st-tool st-tool--danger"
              aria-label={`Retirer la série ${series.letter}`}
              title="Retirer"
              onClick={() => {
                if (variant === series.letter) onVariant(null);
                onChange({ ...stage, variants: stage.variants.filter((v) => v.letter !== series.letter) });
              }}
            >
              <ScIcon name="close" />
            </button>
          </li>
        ))}
      </ul>
      {letter === null ? null : (
        <div className="st-actions">
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm st-add"
            onClick={() => {
              onChange({
                ...stage,
                variants: [...stage.variants, { letter, hint: `Série ${letter} : ce qui change` }],
              });
              onVariant(letter);
            }}
          >
            <ScIcon name="plus" size={15} />
            {`Série ${letter}`}
          </button>
        </div>
      )}
    </fieldset>
  );
}
