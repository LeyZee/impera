import { FanCardFieldSchema, FanCardSourceSchema } from '@impera/contracts';
import { parse } from 'yaml';
import { z } from 'zod';

const Regex = z.string().refine((source) => {
  try {
    new RegExp(source, 'iu');
    return true;
  } catch {
    return false;
  }
}, 'not a valid regular expression');

/**
 * One scenario of his card read in his messages (`evals/card/*.yaml`, ADR 0085 § 7): the card as it is, the messages
 * already read, his new ones, and what the read must (or must not) propose once the code has checked it. Invented
 * fan, invented messages (ADR 0010).
 */
const CardScenarioSchema = z
  .object({
    description: z.string().min(1),
    tier: z.enum(['smoke', 'full']).default('smoke'),
    /** The card as the read gets it: `code : valeur (source)`. */
    card: z.array(z.string().min(1)).default([]),
    history: z
      .array(z.object({ from: z.enum(['fan', 'creator']), text: z.string().min(1) }).strict())
      .default([]),
    inbound: z.array(z.string().min(1)).min(1),
    expect: z
      .object({
        /** Fields the read must propose, with the source the card writes and a pattern its value matches. */
        proposed: z
          .array(
            z
              .object({
                field: FanCardFieldSchema,
                source: FanCardSourceSchema.optional(),
                match: Regex.optional(),
              })
              .strict(),
          )
          .default([]),
        /** Fields it must not propose. */
        absent: z.array(FanCardFieldSchema).default([]),
        /** Patterns no proposed value may match (an order he slipped in, what the card never keeps). */
        must_not_match: z.array(Regex).default([]),
      })
      .strict(),
  })
  .strict();
export type CardScenario = z.infer<typeof CardScenarioSchema>;

export function readCardScenario(source: string): CardScenario {
  return CardScenarioSchema.parse(parse(source));
}

/** What the read proposed, once checked by the code: each field, its source and its value. */
export interface CardOutcome {
  readonly proposals: readonly { readonly field: string; readonly kind: string; readonly value: string }[];
}

/** The failures of a card scenario, in French as the report prints them; none when it passes. */
export function checkCardScenario(scenario: CardScenario, outcome: CardOutcome): string[] {
  const failures: string[] = [];
  for (const wanted of scenario.expect.proposed) {
    const found = outcome.proposals.filter((p) => p.field === wanted.field);
    if (found.length === 0) {
      failures.push(`case ${wanted.field} non proposée`);
      continue;
    }
    if (wanted.source !== undefined && !found.some((p) => p.kind === wanted.source))
      failures.push(`case ${wanted.field} : source attendue ${wanted.source}`);
    if (wanted.match !== undefined && !found.some((p) => new RegExp(wanted.match ?? '', 'iu').test(p.value)))
      failures.push(`case ${wanted.field} : valeur hors du motif ${wanted.match}`);
  }
  for (const field of scenario.expect.absent) {
    if (outcome.proposals.some((p) => p.field === field)) failures.push(`case ${field} proposée à tort`);
  }
  for (const pattern of scenario.expect.must_not_match) {
    const regex = new RegExp(pattern, 'iu');
    const hit = outcome.proposals.find((p) => regex.test(p.value));
    if (hit !== undefined) failures.push(`case ${hit.field} : valeur interdite (${pattern})`);
  }
  return failures;
}
