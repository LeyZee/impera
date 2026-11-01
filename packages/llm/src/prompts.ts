import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { LlmRoleSchema } from './config';

const PromptHeaderSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  role: LlmRoleSchema,
  model_hint: z.string().min(1),
  output_schema: z.string().min(1),
});
type PromptHeader = z.infer<typeof PromptHeaderSchema>;

export interface PromptTemplate {
  readonly name: string;
  readonly header: PromptHeader;
  /** sha256 of the whole file: stored with each call so a draft says which prompt wrote it. */
  readonly hash: string;
  readonly body: string;
  readonly variables: readonly string[];
}

const VARIABLE = /\{\{(\w+)\}\}/g;

export function parsePrompt(name: string, raw: string): PromptTemplate {
  // A Windows checkout may turn LF into CRLF: same prompt, same hash on every machine.
  const source = raw.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`prompt ${name}: missing YAML header`);
  }
  const fields = Object.fromEntries(
    match[1].split('\n').map((line) => {
      const separator = line.indexOf(':');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }),
  );
  const body = match[2].trim();
  return {
    name,
    header: PromptHeaderSchema.parse(fields),
    hash: createHash('sha256').update(source).digest('hex'),
    body,
    variables: [...new Set([...body.matchAll(VARIABLE)].map((m) => m[1] ?? ''))],
  };
}

/** Strict template: every variable must be given, and no unknown one is accepted. */
export function renderPrompt(template: PromptTemplate, values: Readonly<Record<string, string>>): string {
  const missing = template.variables.filter((v) => !(v in values));
  const unknown = Object.keys(values).filter((v) => !template.variables.includes(v));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `prompt ${template.name}: missing [${missing.join(', ')}], unknown [${unknown.join(', ')}]`,
    );
  }
  return template.body.replace(VARIABLE, (_, key: string) => values[key] ?? '');
}

export function loadPrompt(role: 'voice' | 'brain' | 'sense' | 'judge', name = 'default'): PromptTemplate {
  const url = new URL(`../prompts/${role}/${name}.md`, import.meta.url);
  return parsePrompt(`${role}/${name}`, readFileSync(url, 'utf8'));
}
