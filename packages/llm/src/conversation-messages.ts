import type { ModelMessage } from 'ai';

import type {
  BrainAlert,
  BrainScript,
  ConversationTurn,
  JudgeSituation,
  TurnMedia,
  VoiceScriptStep,
} from './gateway-types';
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

const STEP_KIND_LABELS: Readonly<Record<VoiceScriptStep['kind'], string>> = {
  free: 'étape offerte (sans prix)',
  paid: 'étape payante',
  bridge: 'pont entre deux étapes (offert, sans prix)',
};

/** A price as she would write it, from the catalogue's minor units: « 15 € », « 12,50 € ». */
function priceLabel(price: NonNullable<VoiceScriptStep['price']>): string {
  const whole = price.amountMinor % 100 === 0;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: price.currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(price.amountMinor / 100);
}

/** The script step code decided (ADR 0098 § 5), as the voice reads it: every value written by code or the agency. */
function scriptStepBlock(step: VoiceScriptStep): string {
  const lines = [
    `Type : ${STEP_KIND_LABELS[step.kind]}.`,
    step.price === null ? 'Prix : aucun, ne parle pas de prix.' : `Prix exact : ${priceLabel(step.price)}.`,
    step.instruction === null ? '' : `Consigne de l’étape : ${step.instruction}`,
    step.mediaSheet === null ? '' : `Ce que contient l’envoi : ${step.mediaSheet}`,
  ].filter((line) => line !== '');
  return wrapUntrusted('script_step', lines.join('\n'));
}

/**
 * The brief the voice follows; her objection reply, when code chose one, and the script step code decided, each in its
 * own typed block after it.
 */
export function describeBrief(brief: Brief, objectionReply?: string, scriptStep?: VoiceScriptStep): string {
  const lines = [
    `Intention du fan : ${brief.intent} (humeur : ${brief.sentiment}).`,
    `À dire : ${brief.replyBrief}`,
    brief.toneHints.length > 0 ? `Ton : ${brief.toneHints.join(', ')}.` : '',
    brief.callback !== undefined ? `Si ça vient naturellement, rappelle : ${brief.callback}` : '',
    brief.selfDisclosure !== undefined ? `Tu peux confier : ${brief.selfDisclosure}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
  return [
    wrapUntrusted('brief', lines),
    objectionReply === undefined ? '' : wrapUntrusted('objection_reply', objectionReply),
    scriptStep === undefined ? '' : scriptStepBlock(scriptStep),
  ]
    .filter((block) => block !== '')
    .join('\n');
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

/**
 * The scripts she may open with him (ADR 0098 § 6): each id beside what it is about, in a typed block; none, the
 * brain is told so and answers none. A step waiting for his answer is said too, for `scriptReply`.
 */
export function scriptsBlock(scripts: readonly BrainScript[], stepWaiting: boolean): string {
  const waiting = stepWaiting
    ? 'Une étape d’un script attend sa réponse : rends `scriptReply`.'
    : 'Aucune étape n’attend sa réponse : ne rends pas `scriptReply`.';
  if (scripts.length === 0) return `Aucun script à proposer : ne rends pas \`scriptPick\`.\n${waiting}`;
  const listed = scripts
    .map((script) => `${script.id} :\n${wrapUntrusted('script_description', script.description)}`)
    .join('\n');
  return `${listed}\n${waiting}`;
}

/**
 * The situation the agent saw, for the judge (evals only): one typed block, its fields as JSON, written by code. Angle
 * brackets are escaped so nothing in it can close the block; absent, the judge is told it knows nothing of the moment.
 */
export function judgeSituationBlock(situation: JudgeSituation | undefined): string {
  if (situation === undefined) return 'Pas d’information sur le moment : son âge n’est pas confirmé.';
  const fields: JudgeSituation = {
    description: situation.description,
    relationshipHours: situation.relationshipHours,
    ageConfirmed: situation.ageConfirmed,
    lastOfferHoursAgo: situation.lastOfferHoursAgo,
    hasNoBudget: situation.hasNoBudget,
    flags: situation.flags,
  };
  const json = JSON.stringify(fields, null, 2).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
  return `<judge_situation>\n${json}\n</judge_situation>`;
}
