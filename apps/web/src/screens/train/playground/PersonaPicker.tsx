import {
  type CreatorId,
  type PersonaOverview,
  type PersonaVersionId,
  type PlaygroundState,
} from '@impera/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import type { Playground } from './usePlayground';

import { useCreators } from '@/creators/api';
import { fetchPersonaOverview } from '@/creators/persona/source';
import { Select } from '@/shell/Select';

const LOAD_FAILED = 'Ses versions ne se chargent pas. Réessaie dans un instant.';
const FOLLOW_FAILED =
  'Sa nouvelle version en vigueur ne se charge pas : la conversation reste sur l’ancienne. Réessaie dans un instant.';

const overviewKey = (creatorId: CreatorId): readonly unknown[] => ['playground-persona', creatorId];

/** Arrow keys of a radio group and the way they move. */
const STEPS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

interface ChipOption {
  value: string;
  label: string;
  /** Said after the label, quieter: « en vigueur ». */
  hint?: string;
}

/** Up to this many choices, chips; past it, the design system's list (docs/design, #566). */
const CHIPS_UP_TO = 5;

/**
 * One choice among a few, as the design system draws it: chips in a radio group, the arrows moving the choice, as
 * Créatrices and the Dashboard do. A chip wraps and never cuts its words, where a native menu cut « en vigueur ».
 */
function Chips({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: readonly ChipOption[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  // The arrows move the focus only: choosing starts the scene over, so it waits for Enter, Space or a click.
  const [focused, setFocused] = useState<number | null>(null);
  const at = focused !== null && focused < options.length ? focused : index;
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (at + step + options.length) % options.length;
    setFocused(next);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  if (options.length > CHIPS_UP_TO) {
    return (
      <div className="pg-who__field">
        <label className="nv-field__label" htmlFor={id}>
          {label}
        </label>
        <Select
          id={id}
          value={value}
          disabled={disabled}
          options={options}
          onChange={(chosen) => {
            if (chosen !== value) onChange(chosen);
          }}
        />
      </div>
    );
  }
  return (
    <div className="pg-who__field">
      <span className="nv-field__label" id={`${id}-label`}>
        {label}
      </span>
      <div
        className="pg-who__chips"
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        ref={ref}
        onKeyDown={onKeyDown}
      >
        {options.map((option, i) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            className="nv-chip"
            aria-checked={option.value === value}
            tabIndex={i === at ? 0 : -1}
            // aria-disabled, not disabled: a greyed chip keeps its focus instead of dropping it on the page.
            aria-disabled={disabled ? true : undefined}
            onFocus={() => {
              setFocused(i);
            }}
            onClick={() => {
              if (!disabled && option.value !== value) onChange(option.value);
            }}
          >
            {option.hint === undefined ? option.label : `${option.label} · ${option.hint}`}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Her version in force: the only one the playground plays (Charles, 11/11), the one her fans read. */
const inForce = (overview: PersonaOverview): { id: PersonaVersionId; version: string } | null =>
  overview.versions.find((v) => v.isActive) ?? null;

/**
 * Elle, at the head of the scene (recette PRO-21): whom the answers speak as, a creator's version in force and no
 * other (Charles, 11/11: no invented persona on screen, no old version). The invented persona stays in the code for
 * the evals and the sandbox, and for a scene opened before any creator has a version in force: the screen then says
 * so. Changing her starts the conversation over.
 */
export function PersonaPicker({ state, pg }: { state: PlaygroundState; pg: Playground }): JSX.Element {
  const client = useQueryClient();
  const creators = useCreators();
  const { played } = state.persona;
  const [problem, setProblem] = useState<string | null>(null);
  const overview = useQuery({
    queryKey: played === null ? ['playground-persona', 'none'] : overviewKey(played.creatorId),
    queryFn: () => (played === null ? Promise.resolve(null) : fetchPersonaOverview(played.creatorId)),
    enabled: played !== null,
  });
  const active = overview.data === undefined || overview.data === null ? null : inForce(overview.data);
  // One choice at a time, her versions' read included: a second click or key waits for the first to land.
  const pending = useRef(false);
  const [choosing, setChoosing] = useState(false);
  const disabled = pg.busy || pg.client.isDemo || choosing;
  const once =
    <A extends unknown[]>(choose: (...args: A) => Promise<boolean>) =>
    async (...args: A): Promise<boolean> => {
      if (pending.current) return false;
      pending.current = true;
      setChoosing(true);
      try {
        return await choose(...args);
      } finally {
        pending.current = false;
        setChoosing(false);
      }
    };

  /**
   * Plays her version in force; says why not when she has none. `failed`: her versions or the scene did not load,
   * which is never told as « no version in force » (relecture #705).
   */
  const playCreator = async (value: string, quiet = false): Promise<'played' | 'none' | 'failed'> => {
    if (!quiet) setProblem(null);
    const creator = creators.data?.find((c) => c.id === value);
    if (creator === undefined) return 'none';
    const hers = await client
      .query({ queryKey: overviewKey(creator.id), queryFn: () => fetchPersonaOverview(creator.id) })
      .catch(() => null);
    if (hers === null) {
      if (!quiet) setProblem(LOAD_FAILED);
      return 'failed';
    }
    const version = inForce(hers);
    if (version === null) {
      if (!quiet)
        setProblem(
          `${creator.displayName} n’a pas de persona en vigueur : active-en une dans Créatrices › Persona.`,
        );
      return 'none';
    }
    const ran = await pg.run((c) =>
      c.choosePersona({ kind: 'version', creatorId: creator.id, versionId: version.id }),
    );
    return ran ? 'played' : 'failed';
  };
  const pickCreator = async (value: string): Promise<boolean> => (await playCreator(value)) === 'played';

  // A scene that opens on the invented persona plays the first creator with a version in force instead.
  const opened = useRef(false);
  const [opening, setOpening] = useState<'none' | 'failed' | null>(null);
  useEffect(() => {
    if (opened.current || played !== null || pg.client.isDemo || creators.data === undefined) return;
    opened.current = true;
    const list = creators.data;
    void once(async () => {
      let failed = false;
      for (const creator of list) {
        const outcome = await playCreator(creator.id, true);
        if (outcome === 'played') return true;
        if (outcome === 'failed') failed = true;
      }
      // A creator whose versions did not load may well have one in force: never say there is none.
      setOpening(failed ? 'failed' : 'none');
      return false;
    })();
  });

  // Another version was put in force since the scene began: the playground follows it, never an old one, once per
  // read of her versions: failed, it is tried again at their next read, never in a loop (relecture #705).
  const followed = useRef<string | null>(null);
  useEffect(() => {
    if (played === null || active === null || active.id === played.versionId || pending.current) return;
    const attempt = `${active.id}@${String(overview.dataUpdatedAt)}`;
    if (followed.current === attempt) return;
    followed.current = attempt;
    void once(async () => {
      const ran = await pg.run((c) =>
        c.choosePersona({ kind: 'version', creatorId: played.creatorId, versionId: active.id }),
      );
      if (!ran) setProblem(FOLLOW_FAILED);
      return ran;
    })();
  });

  const hint = pg.client.isDemo
    ? 'En démonstration, sans serveur, l’agent parle avec une persona inventée.'
    : played !== null
      ? 'Sa version en vigueur, celle que lisent ses fans. Tes notes vont à cette créatrice ; changer recommence la conversation.'
      : opening === 'none'
        ? 'Aucune créatrice n’a de persona en vigueur : active-en une dans Créatrices › Persona.'
        : opening === 'failed'
          ? 'Les personas ne se chargent pas. Choisis une créatrice pour réessayer.'
          : null;

  return (
    <section className="pg-who" aria-label="Elle">
      <p className="nv-eyebrow">Elle</p>
      {(creators.data ?? []).length === 0 ? null : (
        <Chips
          label="Persona"
          value={played?.creatorId ?? ''}
          disabled={disabled}
          onChange={(value) => void once(pickCreator)(value)}
          options={(creators.data ?? []).map((creator) => ({
            value: creator.id,
            label: creator.displayName,
          }))}
        />
      )}
      {played === null ? null : (
        <p className="pg-who__version">
          Version {played.version} <span className="pg-who__in-force">· en vigueur</span>
        </p>
      )}
      {hint === null ? null : <p className="pg-hint">{hint}</p>}
      {problem === null ? null : (
        <p className="pg-error is-warn" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
