import type { ModelMessage } from 'ai';

import type { BrainAlert, ConversationTurn, TurnMedia } from './gateway-types';
import type { Brief } from './schemas';
import { wrapUntrusted } from './untrusted';

const LABELS = {
  image: 'Photo',
  video: 'Vidéo',
  audio: 'Vocal',
} as const;

/** A description as the brain and the voice read it: plain French, closed values kept as they are. */
function renderMedia(media: TurnMedia): string {
  const d = media.description;
  const duration = d.durationS === null ? '' : ` de ${String(Math.round(d.durationS))} s`;
  if (media.isLocked === true) {
    // Not bought yet: the voice gets enough to tease it, never enough to give it away for free.
    return [
      `${LABELS[d.kind]}${duration} (verrouillé, pas encore acheté).`,
      `Intensité : ${d.intensity}.`,
      d.mood.length > 0 ? `Ambiance : ${d.mood.join(', ')}.` : '',
      d.setting === null ? '' : `Décor : ${d.setting}.`,
    ]
      .filter((line) => line !== '')
      .join('\n');
  }
  return [
    `${LABELS[d.kind]}${duration}.`,
    d.factualDescription,
    ...d.segments.map((s) => `De ${String(s.startS)} à ${String(s.endS)} s : ${s.description}`),
    `Intensité : ${d.intensity}. Visible : ${d.anatomyVisible.join(', ') || 'rien de particulier'}.`,
    d.mood.length > 0 ? `Ambiance : ${d.mood.join(', ')}.` : '',
    d.setting === null ? '' : `Décor : ${d.setting}.`,
    d.audio?.transcript ? `Ce qui est dit : « ${d.audio.transcript} ».` : '',
    d.textVisible === null ? '' : `Texte écrit dans le média : « ${d.textVisible} ».`,
    d.confidenceLow ? 'Description incertaine.' : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function toMessages(history: readonly ConversationTurn[]): ModelMessage[] {
  return history.map((turn) => {
    const isFan = turn.from === 'fan';
    const media = (turn.media ?? []).map((m) =>
      wrapUntrusted(isFan ? 'fan_media_description' : 'creator_media_description', renderMedia(m)),
    );
    if (isFan) {
      const text = turn.text.trim() === '' ? [] : [wrapUntrusted('fan_message', turn.text)];
      return { role: 'user', content: [...text, ...media].join('\n') };
    }
    return { role: 'assistant', content: [turn.text, ...media].filter((part) => part !== '').join('\n') };
  });
}

export function describeBrief(brief: Brief): string {
  const lines = [
    `Intention du fan : ${brief.intent} (humeur : ${brief.sentiment}).`,
    `À dire : ${brief.replyBrief}`,
    brief.toneHints.length > 0 ? `Ton : ${brief.toneHints.join(', ')}.` : '',
    brief.callback !== undefined ? `Si ça vient naturellement, rappelle : ${brief.callback}` : '',
    brief.selfDisclosure !== undefined ? `Tu peux confier : ${brief.selfDisclosure}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
  return wrapUntrusted('brief', lines);
}

export function notesBlock(fanNotes: string): string {
  return fanNotes.trim() === ''
    ? 'Rien pour l’instant : c’est le début de votre relation.'
    : wrapUntrusted('fan_notes', fanNotes);
}

/**
 * Her alerts for the brain (P4-01): each id beside its phrase, the phrase in a typed block like any text the code
 * did not write itself; none, the brain is told so and answers none.
 */
export function alertsBlock(alerts: readonly BrainAlert[]): string {
  if (alerts.length === 0) return 'Aucune : ne rends pas `alertsSeen`.';
  return alerts.map((alert) => `${alert.id} :\n${wrapUntrusted('creator_alert', alert.phrase)}`).join('\n');
}
