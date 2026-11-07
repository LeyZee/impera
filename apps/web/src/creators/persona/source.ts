import {
  ApiErrorSchema,
  REAUTHENTICATION_ERROR_CODE,
  PersonaOverviewSchema,
  PersonaSchema,
  PersonaSampleReplyUnprocessableDetailsSchema,
  personaSheetFromV1,
  PersonaV2Schema,
  PersonaVersionSummarySchema,
  type PersonaMove,
  type PersonaOverview,
  type PersonaV2,
  type PersonaSampleReplyFault,
  type PersonaVersionSummary,
} from '@impera/contracts';
import { useCallback, useEffect, useState } from 'react';

import { firstDraft, schemaIssues, type Draft, type FieldIssue } from './model';

/**
 * Where the persona screen reads from: her stored versions (`GET /v1/creators/:id/persona`), at format 2 (ADR 0079),
 * or, while she has none or no creator is known, the placeholder of the repository (`personas/messalina/v0.1.0.yaml`,
 * ADR 0010), shown « Jamais enregistrée ». A first save from the example becomes her first version.
 */
type PersonaSource = 'example' | 'api';

export interface PersonaReady {
  readonly kind: 'ready';
  /** Her newest version at format 2: as stored, or converted from format 1 by the API; the example's first draft. */
  readonly persona: Draft;
  readonly source: PersonaSource;
  /** The format her newest version was stored in: a format-1 version is saved again at format 2. */
  readonly format: 1 | 2;
  /** What the conversion of a format-1 version put in a nearby question (ADR 0079 § 5), said on the screen. */
  readonly moved: readonly PersonaMove[];
  /** Hash of the version the edit starts from, sent back on save; null before her first version. */
  readonly basedOn: string | null;
  /** Her stored versions, newest first. */
  readonly versions: readonly PersonaVersionSummary[];
}

export type PersonaLoad = { readonly kind: 'loading' } | { readonly kind: 'failed' } | PersonaReady;

/** `GET /v1/creators/:id/persona`: her latest version and every stored one, newest first, the active one marked. */
export async function fetchPersonaOverview(creatorId: string): Promise<PersonaOverview> {
  const response = await fetch(`/v1/creators/${encodeURIComponent(creatorId)}/persona`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`GET persona: ${String(response.status)}`);
  return PersonaOverviewSchema.parse(await response.json());
}

/** Parses the YAML text of a format-2 persona file; throws when it does not pass `PersonaV2Schema`. */
export async function parsePersonaYaml(text: string): Promise<PersonaV2> {
  const { parse } = await import('yaml');
  return PersonaV2Schema.parse(parse(text));
}

/** A persona file is a few kilobytes of text: anything past this is not one, and is not read. */
export const PERSONA_FILE_MAX_BYTES = 256 * 1024;

export type PersonaFileRead =
  /** A file at format 1 is converted (ADR 0079 § 5): `moved` says what went to a nearby question. */
  | {
      readonly kind: 'persona';
      readonly persona: PersonaV2;
      readonly format: 1 | 2;
      readonly moved: readonly PersonaMove[];
    }
  /** Read as YAML, but its format's schema refuses it: what it refuses, in French. */
  | { readonly kind: 'invalid'; readonly issues: readonly FieldIssue[]; readonly format: 1 | 2 }
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
  if (formatOf(value) === 2) {
    const persona = PersonaV2Schema.safeParse(value);
    return persona.success
      ? { kind: 'persona', persona: persona.data, format: 2, moved: [] }
      : { kind: 'invalid', issues: schemaIssues(value), format: 2 };
  }
  const old = PersonaSchema.safeParse(value);
  if (!old.success) return { kind: 'invalid', issues: schemaIssues(value, PersonaSchema), format: 1 };
  const { persona, moved } = personaSheetFromV1(old.data);
  return { kind: 'persona', persona, format: 1, moved };
}

/** The format a file says it is written in (`meta.schema`); a file that says nothing is read as format 1. */
function formatOf(value: object): 1 | 2 {
  const meta: unknown = 'meta' in value ? value.meta : undefined;
  return typeof meta === 'object' && meta !== null && 'schema' in meta && meta.schema === 2 ? 2 : 1;
}

/** Loaded on demand: the YAML parser and the file only reach the browser on this page. */
async function loadExample(): Promise<PersonaV2> {
  const file = await import('../../../../../personas/messalina/v0.1.0.yaml?raw');
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
      format: 2,
      moved: [],
      basedOn: null,
      versions: [],
    };
  };
  if (creatorId === null) return empty();
  const { latest, versions } = await fetchPersonaOverview(creatorId);
  if (latest === null) return empty();
  return {
    kind: 'ready',
    // The API converts a format-1 version (ADR 0079 § 5); the screen edits format 2 only.
    persona: latest.draft,
    source: 'api',
    format: 'sheet' in latest.persona ? 2 : 1,
    moved: latest.moved,
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
  /** A line of « Réponses typiques » holds what a hard guard blocks: which ones, and why. */
  | { readonly kind: 'unprocessable'; readonly faults: readonly PersonaSampleReplyFault[] }
  | { readonly kind: 'failed' };

/** `POST /v1/creators/:id/persona/versions`: stores a new version, never active. */
export async function saveVersion(
  creatorId: string,
  persona: PersonaV2,
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

/**
 * `reauth`: her persona speaks to every fan, a sign-in older than 10 minutes asks for the password again (M1).
 * `refused`: a version stored before a guard changed teaches what it blocks now (P5-01, checked again on activation).
 */
export type ActivateResult = 'activated' | 'conflict' | 'reauth' | 'refused' | 'forbidden' | 'failed';

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
  if (response.status !== 403 && response.status !== 422) return 'failed';
  const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  const code = error.success ? error.data.error.code : null;
  if (response.status === 422) return code === 'persona_sample_reply_unprocessable' ? 'refused' : 'failed';
  return code === REAUTHENTICATION_ERROR_CODE ? 'reauth' : 'forbidden';
}
