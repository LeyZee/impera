import {
  CAPTION_HINT_LABELS,
  CAPTION_PROPOSALS,
  CAPTION_STYLE_LABELS,
  CaptionHintSchema,
  DECISION_OTHER_IDEAS_MAX,
  type CaptionStyle,
  type DecisionAnswer,
  type NewCreatorDecision,
} from '@impera/contracts';
import { z } from 'zod';

import { captionFaults, type CaptionFault } from './caption-guard';
import { CaptionHintUnknown } from './errors';

/** A caption as the model wrote it: its style and its text. */
export interface WrittenCaption {
  readonly style: CaptionStyle;
  readonly text: string;
}

/** What the guard and the code keep of what the model wrote. */
export interface KeptCaptions {
  /** The captions that pass, each style and each text once, in the order written; `CAPTION_PROPOSALS` at most. */
  readonly kept: readonly WrittenCaption[];
  /** What refused the others: rule names only, for the one rewrite and the audit, never a text. */
  readonly refusedBy: readonly CaptionFault[];
}

const folded = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Reads what the model wrote: a caption the guard refuses, a style or a text given twice, are left out. */
export function keepCaptions(written: readonly WrittenCaption[]): KeptCaptions {
  const kept: WrittenCaption[] = [];
  const refusedBy = new Set<CaptionFault>();
  const styles = new Set<CaptionStyle>();
  const texts = new Set<string>();
  for (const caption of written) {
    const text = caption.text.trim();
    const faults = captionFaults(text);
    for (const fault of faults) refusedBy.add(fault);
    if (faults.length > 0 || styles.has(caption.style) || texts.has(folded(text))) continue;
    if (kept.length === CAPTION_PROPOSALS) break;
    styles.add(caption.style);
    texts.add(folded(text));
    kept.push({ style: caption.style, text });
  }
  return { kept, refusedBy: [...refusedBy] };
}

/** The rows of a caption card, the words fixed here: each answer is named by its style, which her choices are read back under. */
export function captionAnswers(captions: readonly WrittenCaption[]): DecisionAnswer[] {
  return captions.map((caption) => ({
    key: caption.style,
    label: CAPTION_STYLE_LABELS[caption.style],
    text: caption.text,
    noted: 'C’est noté. Cette légende partira avec ton Reel.',
  }));
}

/** The drop a caption decision is about, from how it was named; `null` for another subject. */
export function dropOfSubject(subject: string): string | null {
  return subject.startsWith('drop:') ? subject.slice('drop:'.length) : null;
}

/** The hints she touched, as the model reads them: her screen's words. A hint this module does not know is refused. */
export function hintWords(hints: readonly string[]): string[] {
  const known = z.array(CaptionHintSchema).safeParse(hints);
  if (!known.success) throw new CaptionHintUnknown();
  return known.data.map((hint) => CAPTION_HINT_LABELS[hint]);
}

/** What is left of other captions once those she already read are taken out, whatever their case or punctuation. */
export function unseen(captions: readonly WrittenCaption[], seen: readonly string[]): WrittenCaption[] {
  const read = new Set(seen.map(folded));
  return captions.filter((caption) => !read.has(folded(caption.text)));
}

/** How the decision of a drop's caption is named: asked twice, written once (ADR 0162 § 3). */
export function captionSubject(dropId: string): string {
  return `drop:${dropId}`;
}

/**
 * The decision card of a Reel's caption (captures « cartes-de-decision-2 »): three rows she reads in full, each with
 * its style, « D'autres idées » three times at most. The words are fixed here, never written by the model.
 */
export function captionDecision(
  dropId: string,
  captions: readonly WrittenCaption[],
  expiresAt: Date,
): NewCreatorDecision {
  return {
    kind: 'caption',
    subject: captionSubject(dropId),
    category: 'socials',
    question: 'Quelle légende pour ton Reel ?',
    context: 'Trois idées écrites à partir de ta vidéo. Tu choisis, je m’occupe du reste.',
    layout: 'rows',
    answers: captionAnswers(captions),
    otherIdeasLeft: DECISION_OTHER_IDEAS_MAX,
    expiresAt: expiresAt.toISOString(),
  };
}
