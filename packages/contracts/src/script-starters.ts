import { z } from 'zod';

import { SCRIPT_COLOR_PRESETS, ScriptStructureBodySchema, type MediaSlot } from './scripts';

/**
 * Starter structures (ADR 0064 § 4): what the workshop offers to duplicate. The first is the structure the agency
 * used in OnlyScript, its stage names as they were (Charles's choice, 03/11/2026, 12:51: in the public repository).
 * An agency method, neither a fan's nor a creator's data (ADR 0010). Parsed on load, and a test holds them to the
 * structure rules (`scriptStructureFaults`). The aftercare that follows the last stage is a text (ADR 0056 § 6), not a
 * stage; how often a fan is offered a stage is the agent's cooldown, never the structure's (Agent's review of SC-01 c1).
 */

/** Three photos and a video of `minSeconds` to `maxSeconds`: what most of its stages ask. */
const shot = (minSeconds: number, maxSeconds: number): MediaSlot[] => [
  { kind: 'image', optional: false, hint: null },
  { kind: 'image', optional: false, hint: null },
  { kind: 'image', optional: false, hint: null },
  { kind: 'video', optional: false, hint: null, minSeconds, maxSeconds },
];

export const ScriptStarterSchema = z.strictObject({
  /** Stable, for the screen. */
  key: z.string().min(1),
  /** What the agency wrote it for, in one sentence. */
  summary: z.string().min(1),
  body: ScriptStructureBodySchema,
});
export type ScriptStarter = z.infer<typeof ScriptStarterSchema>;

export const ScriptStarterListSchema = z.object({ starters: z.array(ScriptStarterSchema) });
export type ScriptStarterList = z.infer<typeof ScriptStarterListSchema>;

const rouge = SCRIPT_COLOR_PRESETS[0].color;

export const SCRIPT_STARTERS: readonly ScriptStarter[] = [
  ScriptStarterSchema.parse({
    key: 'onlyscript',
    summary:
      'La structure d’OnlyScript : un teasing offert en trois séries, six étapes payantes, un pont entre deux.',
    body: {
      name: 'Structure de départ',
      moment: 'both',
      color: rouge,
      reservedCreatorId: null,
      segments: [
        {
          kind: 'stage',
          key: 'teasing',
          name: 'Teasing',
          intention: 'Faire comprendre au fan que tu as envie de l’exciter',
          access: 'free',
          mood: null,
          mediaSlots: shot(20, 45),
          variants: [
            { letter: 'A', hint: 'Première série' },
            { letter: 'B', hint: 'Deuxième série' },
            { letter: 'C', hint: 'Troisième série' },
          ],
        },
        {
          kind: 'stage',
          key: 'seins',
          name: 'Seins',
          intention: 'Montrer les seins de façon claire et sensuelle',
          access: 'paid',
          mood: null,
          mediaSlots: shot(60, 120),
          variants: [],
        },
        {
          kind: 'bridge',
          key: 'pont-seins-chatte',
          from: 'seins',
          to: 'chatte',
          teaser: 'Faire comprendre au fan que tu vas lui montrer ta chatte',
          mediaSlots: [{ kind: 'image', optional: false, hint: 'Photo teasing' }],
        },
        {
          kind: 'stage',
          key: 'chatte',
          name: 'Chatte',
          intention: 'Révéler la chatte après le teasing du pont',
          access: 'paid',
          mood: null,
          mediaSlots: shot(120, 180),
          variants: [],
        },
        {
          kind: 'bridge',
          key: 'pont-chatte-masturbation',
          from: 'chatte',
          to: 'masturbation',
          teaser: 'Faire comprendre au fan que tu vas te doigter',
          mediaSlots: [{ kind: 'image', optional: false, hint: 'Photo teasing' }],
        },
        {
          kind: 'stage',
          key: 'masturbation',
          name: 'Masturbation',
          intention: 'Masturbation solo aux doigts',
          access: 'paid',
          mood: null,
          mediaSlots: shot(120, 180),
          variants: [],
        },
        {
          kind: 'bridge',
          key: 'pont-masturbation-god',
          from: 'masturbation',
          to: 'jeux-god',
          teaser: 'Faire comprendre au fan que tu vas t’amuser avec un god',
          mediaSlots: [{ kind: 'image', optional: false, hint: 'Photo teasing' }],
        },
        {
          kind: 'stage',
          key: 'jeux-god',
          name: 'Jeux God',
          intention: 'Jeux avec un god',
          access: 'paid',
          mood: null,
          mediaSlots: shot(60, 120),
          variants: [],
        },
        {
          kind: 'bridge',
          key: 'pont-god-penetration',
          from: 'jeux-god',
          to: 'penetration',
          teaser: 'Faire comprendre au fan que tu vas te pénétrer',
          mediaSlots: [{ kind: 'image', optional: false, hint: 'Photo teasing' }],
        },
        {
          kind: 'stage',
          key: 'penetration',
          name: 'Pénétration',
          intention: 'Pénétration explicite',
          access: 'paid',
          mood: null,
          mediaSlots: shot(150, 300),
          variants: [],
        },
        {
          kind: 'stage',
          key: 'orgasme',
          name: 'Orgasme',
          intention: 'Orgasme final',
          access: 'paid',
          mood: null,
          mediaSlots: [{ kind: 'video', optional: false, hint: null, minSeconds: 180, maxSeconds: 300 }],
          variants: [],
        },
      ],
    },
  }),
];
