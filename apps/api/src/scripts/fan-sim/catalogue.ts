import { parse } from 'yaml';
import { z } from 'zod';

import type { AgentScriptView } from '../../modules/agent/index';
import type { PlaygroundScript, ShownMedia } from '../../modules/playground/index';

/**
 * The simulated fans' catalogue (Charles 26/11: « l'IA choisit le script le plus proche du fantasme »): invented
 * scripts, each on one theme, so the test can tell whether she picks the one closest to his fantasy. Built as the
 * playground's trial scripts are (ADR 0103 § 15-17), read by the same domain functions as production. Invented from
 * end to end: no media, no price nor text of the agency.
 */

const Ref = z.string().regex(/^[a-z][a-z0-9-]*$/u);
const MediaSchema = z.object({ kind: z.enum(['image', 'video']), description: z.string().min(1) }).strict();
const StepSchema = z
  .object({
    kind: z.enum(['free', 'paid', 'bridge']),
    price_euros: z.number().positive().optional(),
    instruction: z.string().min(1),
    text: z.string().default(''),
    media: z.array(MediaSchema).default([]),
    teaser: z.array(MediaSchema).default([]),
  })
  .strict();

const SimCatalogueSchema = z
  .object({
    scripts: z
      .array(
        z
          .object({
            ref: Ref,
            name: z.string().min(1),
            moment: z.enum(['day', 'night']).nullable().default(null),
            description: z.string().min(1),
            steps: z.array(StepSchema).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type SimCatalogue = z.infer<typeof SimCatalogueSchema>;

/** Each script as a platform would list it, its media numbered across the catalogue. */
export function playgroundScriptsOf(catalogue: SimCatalogue): PlaygroundScript[] {
  let counter = 0;
  const shown = (media: z.infer<typeof MediaSchema>): ShownMedia => {
    counter += 1;
    return { ref: `sim-media-${String(counter)}`, kind: media.kind, description: media.description };
  };
  return catalogue.scripts.map((script) => {
    const steps = script.steps.map((step) => ({
      step,
      media: step.media.map(shown),
      teaser: step.teaser.map(shown),
    }));
    const view: AgentScriptView = {
      scriptRef: script.ref,
      moment: script.moment,
      description: script.description,
      steps: steps.map(({ step, media }, index) => ({
        stepRef: `${script.ref}:${String(index)}`,
        kind: step.kind,
        priceMinor: step.price_euros === undefined ? null : Math.round(step.price_euros * 100),
        instruction: step.instruction,
        ...(media.length > 0 && { mediaSheet: media.map((each) => each.description ?? '').join(' ') }),
        mediaRefs: media.map((each) => each.ref),
      })),
      mediaValidated: true,
      descriptionValidated: true,
      touchesLimits: false,
    };
    return {
      view,
      name: script.name,
      steps: steps.map(({ step, media, teaser }) => ({ text: step.text, media, teaser })),
    };
  });
}

export function parseSimCatalogue(text: string): SimCatalogue {
  return SimCatalogueSchema.parse(parse(text));
}
