import {
  ApiErrorSchema,
  REAUTHENTICATION_ERROR_CODE,
  PersonaOverviewSchema,
  PersonaSchema,
  PersonaSampleReplyUnprocessableDetailsSchema,
  PersonaVersionSummarySchema,
  type Persona,
  type PersonaOverview,
  type PersonaSampleReplyFault,
  type PersonaVersionSummary,
} from '@impera/contracts';
import { useCallback, useEffect, useState } from 'react';

import { firstDraft, schemaIssues, type FieldIssue } from './model';

/**
 * Where the persona screen reads from: her stored versions (`GET /v1/creators/:id/persona`), or, while she has none
 * or no creator is known, the placeholder of the repository (`personas/messalina/v0.0.0.yaml`, ADR 0010), shown with
 * an « Exemple » badge. A first save from the example becomes her first version.
 */
type PersonaSource = 'example' | 'api';

export interface PersonaReady {
  readonly kind: 'ready';
  readonly persona: Persona;
  readonly source: PersonaSource;
  /** Hash of the version the edit starts from, sent back on save; null before her first version. */
  readonly basedOn: string | null;
  /** Her stored versions, newest first. */
  readonly versions: readonly PersonaVersionSummary[];
}

export type PersonaLoad = { readonly kind: 'loading' } | { readonly kind: 'failed' } | PersonaReady;

/** Parses the YAML text of a persona file; throws when it does not pass `PersonaSchema`. */
/** `GET /v1/creators/:id/persona`: her latest version and every stored one, newest first, the active one marked. */
export async function fetchPersonaOverview(creatorId: string): Promise<PersonaOverview> {
  const response = await fetch(`/v1/creators/${encodeURIComponent(creatorId)}/persona`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`GET persona: ${String(response.status)}`);
  return PersonaOverviewSchema.parse(await response.json());
}

export async function parsePersonaYaml(text: string): Promise<Persona> {
  const { parse } = await import('yaml');
  return PersonaSchema.parse(parse(text));
}

/** A persona file is a few kilobytes of text: anything past this is not one, and is not read. */
export const PERSONA_FILE_MAX_BYTES = 256 * 1024;

export type PersonaFileRead =
  | { readonly kind: 'persona'; readonly persona: Persona }
  /** Read as YAML, but `PersonaSchema` refuses it: what it refuses, in French. */
  | { readonly kind: 'invalid'; readonly issues: readonly FieldIssue[] }
  /** Not YAML, not text, or too big to be a persona. */
  | { readonly kind: 'unreadable' };

/** Reads a persona file the owner or the creator picked (« Importer un fichier »); nothing is sent anywhere. */
export async function readPersonaFile(file: File): Promise<PersonaFileRead> {
  if (file.size > PERSONA_FILE_MAX_BYTES) return { kind: 'unreadable' };
  let value: unknown;
  try {
    const { parse } = await import('yaml');
    value = parse(await file.text());
  } catch {
    return { kind: 'unreadable' };
  }
  if (typeof value !== 'object' || value === null) return { kind: 'unreadable' };
  const persona = PersonaSchema.safeParse(value);
  return persona.success
    ? { kind: 'persona', persona: persona.data }
    : { kind: 'invalid', issues: schemaIssues(value) };
}

/** Loaded on demand: the YAML parser and the file only reach the browser on this page. */
async function loadExample(): Promise<Persona> {
  const file = await import('../../../../../personas/messalina/v0.0.0.yaml?raw');
  return parsePersonaYaml(file.default);
}

async function loadPersona(creatorId: string | null, name: string | null): Promise<PersonaReady> {
  const empty = async (): Promise<PersonaReady> => {
    const example = await loadExample();
    return {
      kind: 'ready',
      // For a known creator, the start of her first version: nothing of the example that nobody typed, her name.
      persona: creatorId === null ? example : firstDraft(example, creatorId, name),
      source: 'example',
      basedOn: null,
      versions: [],
    };
  };
  if (creatorId === null) return empty();
  const { latest, versions } = await fetchPersonaOverview(creatorId);
  if (latest === null) return empty();
  return {
    kind: 'ready',
    persona: latest.persona,
    source: 'api',
    basedOn: latest.summary.contentHash,
    versions,
  };
}

/** The one hook the screen reads the persona through; `reload` fetches it again (after a save, for instance). */
export function usePersona(
  creatorId: string | null,
  /** Her name in Impera: the first name of a persona she has not written yet starts from it (CREA-13). */
  name: string | null = null,
): { load: PersonaLoad; reload: () => void } {
  const [load, setLoad] = useState<PersonaLoad>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    loadPersona(creatorId, name).then(
      (ready) => {
        if (live) setLoad(ready);
      },
      () => {
        if (live) setLoad({ kind: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [creatorId, name, attempt]);

  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { load, reload };
}

export type SaveResult =
  | { readonly kind: 'saved'; readonly version: PersonaVersionSummary }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'forbidden' }
  /** A sample reply holds what a hard guard blocks: which ones, and why. */
  | { readonly kind: 'unprocessable'; readonly faults: readonly PersonaSampleReplyFault[] }
  | { readonly kind: 'failed' };

/** `POST /v1/creators/:id/persona/versions`: stores a new version, never active. */
export async function saveVersion(
  creatorId: string,
  persona: Persona,
  basedOn: string | null,
): Promise<SaveResult> {
  const response = await fetch(`/v1/creators/${encodeURIComponent(creatorId)}/persona/versions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ persona, basedOn }),
  });
  if (response.status === 201) {
    return { kind: 'saved', version: PersonaVersionSummarySchema.parse(await response.json()) };
  }
  const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  const code = error.success ? error.data.error.code : null;
  if (code === 'persona_version_conflict') return { kind: 'conflict' };
  if (code === 'persona_sample_reply_unprocessable') {
    const details = PersonaSampleReplyUnprocessableDetailsSchema.safeParse(error.data?.error.details);
    if (details.success) return { kind: 'unprocessable', faults: details.data.faults };
  }
  if (response.status === 403) return { kind: 'forbidden' };
  return { kind: 'failed' };
}

/** `reauth`: her persona speaks to every fan, a sign-in older than 10 minutes asks for the password again (M1). */
export type ActivateResult = 'activated' | 'conflict' | 'reauth' | 'forbidden' | 'failed';

/**
 * `POST /v1/creators/:id/persona/versions/:versionId/activate`. `expectedActive` is her active version as this screen
 * read it: if another became active since (another tab), the server refuses (409) and nothing changes.
 */
export async function activateVersion(
  creatorId: string,
  versionId: string,
  expectedActive: string | null,
): Promise<ActivateResult> {
  const response = await fetch(
    `/v1/creators/${encodeURIComponent(creatorId)}/persona/versions/${encodeURIComponent(versionId)}/activate`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedActive }),
    },
  );
  if (response.ok) return 'activated';
  if (response.status === 409) return 'conflict';
  if (response.status !== 403) return 'failed';
  const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  return error.success && error.data.error.code === REAUTHENTICATION_ERROR_CODE ? 'reauth' : 'forbidden';
}
