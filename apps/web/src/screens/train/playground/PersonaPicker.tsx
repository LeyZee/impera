import {
  PersonaOverviewSchema,
  type CreatorId,
  type PersonaOverview,
  type PersonaVersionId,
  type PlaygroundState,
} from '@impera/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { Playground } from './usePlayground';

import { useCreators } from '@/creators/api';
import { activateVersion } from '@/creators/persona/source';
import { PasswordPrompt } from '@/settings/services/PasswordPrompt';

/** The value of the invented persona in the creators' list: no creator has an empty id. */
const INVENTED = '';

const overviewKey = (creatorId: CreatorId): readonly unknown[] => ['playground-persona', creatorId];

/** Arrow keys of a radio group and the way they move. */
const STEPS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

interface ChipOption {
  value: string;
  label: string;
}

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
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key];
    if (step === undefined || disabled) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
    const option = options[next];
    if (option !== undefined && option.value !== value) onChange(option.value);
  };
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
            tabIndex={i === index ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              if (option.value !== value) onChange(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** `GET /v1/creators/:id/persona`: her versions, newest first, the active one marked. */
async function fetchOverview(creatorId: CreatorId): Promise<PersonaOverview> {
  const response = await fetch(`/v1/creators/${encodeURIComponent(creatorId)}/persona`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`GET persona: ${String(response.status)}`);
  return PersonaOverviewSchema.parse(await response.json());
}

/** Her version in force, else her newest: the one a trainer most likely wants to hear first. */
const firstOf = (overview: PersonaOverview): PersonaVersionId | null =>
  (overview.versions.find((v) => v.isActive) ?? overview.versions[0])?.id ?? null;

/**
 * Elle, at the head of the scene (recette PRO-21): whom the answers speak as, the invented persona or a creator's
 * version, the inactive ones included, so that a version is heard before it speaks to her fans. A version not yet
 * active is activated from here once it convinces, with the password asked again as in Créatrices. Changing her
 * starts the conversation over.
 */
export function PersonaPicker({ state, pg }: { state: PlaygroundState; pg: Playground }): JSX.Element {
  const client = useQueryClient();
  const creators = useCreators();
  const { played } = state.persona;
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const overview = useQuery({
    queryKey: played === null ? ['playground-persona', 'none'] : overviewKey(played.creatorId),
    queryFn: () => (played === null ? Promise.resolve(null) : fetchOverview(played.creatorId)),
    enabled: played !== null,
  });
  const versions = overview.data?.versions ?? [];
  const current = played === null ? undefined : versions.find((v) => v.id === played.versionId);
  const disabled = pg.busy || pg.client.isDemo;

  const play = async (creatorId: CreatorId, versionId: PersonaVersionId): Promise<void> => {
    setDone(null);
    await pg.run((c) => c.choosePersona({ kind: 'version', creatorId, versionId }));
  };

  const pickCreator = async (value: string): Promise<void> => {
    setProblem(null);
    setDone(null);
    if (value === INVENTED) {
      await pg.run((c) => c.choosePersona({ kind: 'invented' }));
      return;
    }
    const creator = creators.data?.find((c) => c.id === value);
    if (creator === undefined) return;
    const hers = await client
      .query({ queryKey: overviewKey(creator.id), queryFn: () => fetchOverview(creator.id) })
      .catch(() => null);
    if (hers === null) {
      setProblem('Ses versions ne se chargent pas. Réessaie dans un instant.');
      return;
    }
    const first = firstOf(hers);
    if (first === null) {
      setProblem(`${creator.displayName} n’a pas encore de persona : écris-la dans Créatrices.`);
      return;
    }
    await play(creator.id, first);
  };

  const activate = async (): Promise<void> => {
    if (played === null || current === undefined) return;
    setProblem(null);
    const expectedActive = versions.find((v) => v.isActive)?.id ?? null;
    const result = await activateVersion(played.creatorId, played.versionId, expectedActive).catch(
      () => 'failed' as const,
    );
    if (result === 'activated') {
      setDone(`Version ${current.version} activée : ses prochains brouillons l’écrivent avec elle.`);
      // The screen says it at once: the version heard is now the one in force, before the list is read again.
      const activated = played.versionId;
      client.setQueryData<PersonaOverview>(overviewKey(played.creatorId), (old) =>
        old === undefined
          ? old
          : { ...old, versions: old.versions.map((v) => ({ ...v, isActive: v.id === activated })) },
      );
      await client.invalidateQueries({ queryKey: overviewKey(played.creatorId) });
    } else if (result === 'reauth') setReauth(true);
    else if (result === 'conflict') {
      setProblem('Une autre version est devenue active entre-temps : rien n’a changé.');
      await client.invalidateQueries({ queryKey: overviewKey(played.creatorId) });
    } else {
      setProblem(
        result === 'forbidden'
          ? 'Seul le propriétaire active une persona.'
          : 'Rien n’a été activé : Impera ne répond pas. Réessaie dans un instant.',
      );
    }
  };

  return (
    <section className="pg-who" aria-label="Elle">
      <p className="nv-eyebrow">Elle</p>
      <Chips
        label="Persona"
        value={played?.creatorId ?? INVENTED}
        disabled={disabled}
        onChange={(value) => void pickCreator(value)}
        options={[
          { value: INVENTED, label: played === null ? `Fictive (${state.persona.name})` : 'Fictive' },
          ...(creators.data ?? []).map((creator) => ({ value: creator.id, label: creator.displayName })),
        ]}
      />
      {played === null ? null : (
        <Chips
          label="Version"
          value={played.versionId}
          disabled={disabled || versions.length === 0}
          onChange={(value) => {
            const chosen = versions.find((v) => v.id === value);
            if (chosen !== undefined) void play(played.creatorId, chosen.id);
          }}
          options={
            versions.length === 0
              ? [{ value: played.versionId, label: played.version }]
              : versions.map((version) => ({
                  value: version.id,
                  label: version.isActive ? `${version.version} · en vigueur` : version.version,
                }))
          }
        />
      )}
      <p className="pg-hint">
        {played === null
          ? 'Choisis une créatrice pour entendre sa persona avant ses fans. Changer recommence la conversation.'
          : current?.isActive === true
            ? 'La version que lisent ses fans. Tes notes vont à cette créatrice.'
            : 'Pas encore active : ses fans ne la lisent pas. Tes notes vont à cette créatrice.'}
      </p>
      {played !== null && current !== undefined && !current.isActive ? (
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm pg-who__activate"
          disabled={pg.busy}
          onClick={() => void activate()}
        >
          Activer cette version
        </button>
      ) : null}
      {reauth ? (
        <PasswordPrompt
          lead="Cette version parlera à tous ses fans : pour l’activer, confirme ton mot de passe et ton code."
          onConfirmed={() => {
            setReauth(false);
            void activate();
          }}
          onCancel={() => {
            setReauth(false);
          }}
        />
      ) : null}
      {problem === null ? null : (
        <p className="pg-error is-warn" role="alert">
          {problem}
        </p>
      )}
      {done === null ? null : (
        <p className="pg-hint" role="status">
          {done}
        </p>
      )}
    </section>
  );
}
