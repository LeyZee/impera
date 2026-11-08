import type { TextPart, UserContent } from 'ai';

import { acceptsInput } from './catalog';
import type { ModelRef } from './config';
import type { DropContext, DropSenseInput, SenseInput, VideoKeyframes } from './gateway-types';
import { wrapUntrusted } from './untrusted';

const INLINE_VIDEO_MAX_BYTES = 20 * 1024 * 1024;

const ORIGIN = { fan: 'Média envoyé par un fan.', creator: 'Média du catalogue de la créatrice.' } as const;

function transcriptPart(transcript: string | undefined): TextPart[] {
  return transcript === undefined
    ? []
    : [{ type: 'text', text: wrapUntrusted('media_transcript', transcript) }];
}

/** The user message of a `sense` call, or undefined when this model cannot read this media. */
export async function senseContent(
  input: SenseInput,
  ref: ModelRef,
  keyframes: () => Promise<VideoKeyframes>,
): Promise<UserContent | undefined> {
  const { media } = input;
  const origin = ORIGIN[input.origin];
  switch (media.kind) {
    case 'image':
      if (!acceptsInput(ref, 'image')) return undefined;
      return [
        { type: 'text', text: `${origin} Photo.` },
        { type: 'file', data: media.data, mediaType: media.mediaType },
      ];
    case 'audio':
      return [
        { type: 'text', text: `${origin} Vocal de ${String(media.durationS)} s, transcrit.` },
        ...transcriptPart(media.transcript),
      ];
    case 'video': {
      const intro = `${origin} Vidéo de ${String(Math.round(media.durationS))} s`;
      if (
        acceptsInput(ref, 'video') &&
        media.data !== null &&
        media.data.byteLength <= INLINE_VIDEO_MAX_BYTES
      ) {
        return [
          { type: 'text', text: `${intro}, avec son.` },
          { type: 'file', data: media.data, mediaType: media.mediaType },
        ];
      }
      if (!acceptsInput(ref, 'image')) return undefined;
      const { frames, transcript } = await keyframes();
      if (frames.length === 0) return undefined;
      return [
        { type: 'text', text: `${intro}, en images extraites et datées :` },
        ...frames.flatMap((frame) => [
          { type: 'text' as const, text: `À ${String(frame.atS)} s :` },
          { type: 'file' as const, data: frame.data, mediaType: frame.mediaType },
        ]),
        ...transcriptPart(transcript),
      ];
    }
  }
}

/** The drop's context in words, built by the code from typed fields, then wrapped as data like anything it quotes. */
function contextText(context: DropContext): string {
  const lines = [`Catégorie : ${context.category}.`];
  const { step } = context;
  if (step !== null) {
    lines.push(
      `Étape ${String(step.number)} du script : ${step.name}.`,
      `Média ${String(step.position)} sur ${String(step.count)} de cette étape.`,
    );
    if (step.instruction !== null) lines.push(`Consigne de l'étape : ${step.instruction}`);
  }
  return wrapUntrusted('drop_context', lines.join('\n'));
}

/**
 * The user message of a `describeDrop` call (ADR 0083): the drop's context, then the media alone, as `sense` reads one
 * of her catalogue. Undefined when this model cannot read it.
 */
export async function dropSenseContent(
  input: DropSenseInput,
  ref: ModelRef,
  keyframes: () => Promise<VideoKeyframes>,
): Promise<UserContent | undefined> {
  const media = await senseContent({ origin: 'creator', media: input.media }, ref, keyframes);
  if (media === undefined) return undefined;
  return [
    { type: 'text', text: contextText(input.context) },
    ...(typeof media === 'string' ? [{ type: 'text' as const, text: media }] : media),
  ];
}
