import {
  MediaDescriptionIdSchema,
  type MediaDescriptionId,
  PlatformAccountIdSchema,
  PlatformScriptIdSchema,
  ScriptIdentityIdSchema,
  type PlatformScriptViewDto,
  type ScriptIdentityView,
} from '@impera/contracts';

/** Invented Reveal scripts for the tests and the screen's captures (ADR 0010): no real creator, media or text. */

type Step = PlatformScriptViewDto['steps'][number];
type Media = Step['media'][number];

const ACCOUNT = PlatformAccountIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a1');

export const descriptionId = (n: number): MediaDescriptionId =>
  MediaDescriptionIdSchema.parse(`0192f3a0-0000-7000-8000-0000000d${String(n).padStart(4, '0')}`);

/** A media of a step, in her vault and imported; its description given, or none. */
export function mediaOf(ref: string, description: Media['description'], over: Partial<Media> = {}): Media {
  return {
    ref,
    kind: 'image',
    inVault: true,
    imported: true,
    mediaAssetId: null,
    described: description?.validated === true,
    description,
    ...over,
  };
}

export function stepOf(position: number, priceMinor: number, media: Media[]): Step {
  return {
    position,
    platformIndex: position,
    ref: `step_${String(position)}`,
    name: `Étape ${String(position + 1)}`,
    text: 'Texte inventé',
    priceMinor,
    currency: 'EUR',
    discount: null,
    media,
    previewMedia: [],
    complete: true,
    condition: null,
    branches: 1,
  };
}

export function revealScriptOf(n: number, over: Partial<PlatformScriptViewDto> = {}): PlatformScriptViewDto {
  return {
    id: PlatformScriptIdSchema.parse(`0192f3a0-0000-7000-8000-0000000c${String(n).padStart(4, '0')}`),
    platformAccountId: ACCOUNT,
    ref: `sequence_${String(n)}`,
    name: `Script inventé ${String(n)}`,
    moment: 'night',
    active: true,
    deactivatedAt: null,
    syncedAt: '2026-11-19T20:00:00.000Z',
    steps: [],
    warnings: [],
    gaps: [],
    proposable: true,
    identity: null,
    ...over,
  };
}

export const IDENTITY_CONTENT = {
  ambiance: 'complice et taquine',
  energy: 'rising' as const,
  setting: 'un salon inventé, lumière douce',
  useWhen: ['il raconte sa soirée', 'il la complimente sur sa tenue'],
  avoidWhen: ['il parle de son travail'],
};

export const identityOf = (validatedAt: string | null): ScriptIdentityView => ({
  id: ScriptIdentityIdSchema.parse('0192f3a0-0000-7000-8000-0000000e0001'),
  moment: 'night',
  content: IDENTITY_CONTENT,
  author: 'brain',
  validatedAt,
});
