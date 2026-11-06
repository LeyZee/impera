import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { StoredPersonaSchema } from '@impera/contracts';
import { parse } from 'yaml';
import type { z } from 'zod';

/**
 * Where the user means: `pnpm persona:load personas/…` runs the script in `apps/api`, so a relative path is taken
 * from the folder the command was typed in (pnpm's `INIT_CWD`).
 */
const fromTypedFolder = (path: string): string => resolve(process.env['INIT_CWD'] ?? process.cwd(), path);

/** Reads a persona YAML and checks it against `StoredPersonaSchema` (format 1 or 2, ADR 0079), for `persona:validate` and `persona:load`. */
export async function readPersonaYaml(
  path: string,
): Promise<z.ZodSafeParseResult<z.output<typeof StoredPersonaSchema>>> {
  return StoredPersonaSchema.safeParse(parse(await readFile(fromTypedFolder(path), 'utf8')));
}

/** One line per problem: where, and what. Never the value itself (the persona stays out of the logs). */
export const describeIssues = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `  ${issue.path.join('.') || '(racine)'} : ${issue.message}`);
