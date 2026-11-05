import {
  PersonaOverviewSchema,
  type CreatorId,
  type PersonaOverview,
  type PersonaVersionId,
  type PlaygroundState,
} from '@impera/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import type { Playground } from './usePlayground';

import { useCreators } from '@/creators/api';
import { activateVersion } from '@/creators/persona/source';
import { PasswordPrompt } from '@/settings/services/PasswordPrompt';

/** The value of the invented persona in the creators' list: no creator has an empty id. */
const INVENTED = '';

const overviewKey = (creatorId: CreatorId): readonly unknown[] => ['playground-persona', creatorId];

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
      <div className="pg-who__row">
        <label className="nv-field pg-who__field">
          <span className="nv-field__label">Persona</span>
          <select
            className="nv-field__control nv-glass"
            value={played?.creatorId ?? INVENTED}
            disabled={disabled}
            onChange={(event) => void pickCreator(event.target.value)}
          >
            <option value={INVENTED}>
              {played === null ? `Persona fictive (${state.persona.name})` : 'Persona fictive'}
            </option>
            {(creators.data ?? []).map((creator) => (
              <option key={creator.id} value={creator.id}>
                {creator.displayName}
              </option>
            ))}
          </select>
        </label>
        {played === null ? null : (
          <label className="nv-field pg-who__field">
            <span className="nv-field__label">Version</span>
            <select
              className="nv-field__control nv-glass"
              value={played.versionId}
              disabled={disabled || versions.length === 0}
              onChange={(event) => {
                const chosen = versions.find((v) => v.id === event.target.value);
                if (chosen !== undefined) void play(played.creatorId, chosen.id);
              }}
            >
              {versions.length === 0 ? <option value={played.versionId}>{played.version}</option> : null}
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.version}
                  {version.isActive ? ' · en vigueur' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
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
