import { CAPTION_PROPOSALS, CreatorIdSchema, DECISION_ANSWERS_MIN } from '@impera/contracts';

import { CaptionWritingFailed } from '../domain/errors';
import type { CaptionPersona, CaptionRequest, DescribedReel, ProposeDeps } from '../domain/ports';
import { captionDecision, captionSubject, keepCaptions, type WrittenCaption } from '../domain/proposals';

/** How long the question of a caption makes sense: a Reel dropped is published within the week. */
const ASKED_FOR_MS = 7 * 24 * 60 * 60_000;

export type ProposeOutcome =
  /** Nothing to do: no live Reel holds this medium, or it has no description yet. */
  | 'nothing'
  /** No active persona: nothing is written in her name. */
  | 'off'
  /** The day's AI budget is spent: the job comes back later. */
  | 'budget'
  | { readonly asked: number; readonly already: number; readonly refused: number };

const isReel = (drop: DescribedReel): boolean => drop.category === 'instagram_reel';

/** What passes the caption guard and the guards of her voice, each style and each text once. */
function kept(
  written: readonly WrittenCaption[],
  persona: CaptionPersona,
): { readonly captions: readonly WrittenCaption[]; readonly refusedBy: readonly string[] } {
  const voice = new Set<string>();
  const inHerVoice = written.filter((caption) => {
    const codes = persona.blocking(caption.text);
    for (const code of codes) voice.add(code);
    return codes.length === 0;
  });
  const read = keepCaptions(inHerVoice);
  return { captions: read.kept, refusedBy: [...read.refusedBy, ...voice] };
}

/** Three captions for one Reel, with one rewrite when the guards left fewer; `budget`, or fewer than a choice needs. */
async function captionsFor(
  deps: Pick<ProposeDeps, 'writer'>,
  persona: CaptionPersona,
  request: CaptionRequest,
): Promise<readonly WrittenCaption[] | 'budget'> {
  const write = async (ask: CaptionRequest): Promise<readonly WrittenCaption[] | 'budget'> => {
    const answer = await deps.writer.write(ask);
    if (answer === 'failed') throw new CaptionWritingFailed(`creator ${ask.creatorId}: every model failed`);
    return answer;
  };
  const first = await write(request);
  if (first === 'budget') return 'budget';
  const read = kept(first, persona);
  if (read.captions.length === CAPTION_PROPOSALS) return read.captions;
  const second = await write({ ...request, refusedBy: read.refusedBy });
  // The first answer's captions that passed stay ahead: the rewrite only fills what the guards left empty.
  if (second === 'budget') return read.captions.length >= DECISION_ANSWERS_MIN ? read.captions : 'budget';
  return kept([...read.captions, ...second], persona).captions;
}

/**
 * `instagram_captions.propose` (ADR 0164 § 9): a medium of hers was described; for each live Reel that holds it, three
 * captions are written from what the video shows and asked to her on a decision card. Replayable: a Reel already asked
 * is left alone (the decision is written once per drop), so a description redone or corrected proposes nothing again.
 * A caption the guards refuse is never shown; fewer than two left, nothing is asked. The agency's validation of the
 * description is not waited for: she reads the captions herself.
 */
export async function proposeCaptions(
  deps: ProposeDeps,
  creatorId: string,
  mediaAssetId: string,
  now: Date,
): Promise<ProposeOutcome> {
  const creator = CreatorIdSchema.parse(creatorId);
  const reels = (await deps.drops(creatorId, mediaAssetId)).filter(isReel);
  if (reels.length === 0) return 'nothing';
  const counts = { asked: 0, already: 0, refused: 0 };
  let persona: CaptionPersona | null | undefined;
  let examples: readonly string[] | undefined;
  for (const reel of reels) {
    if (await deps.asking.asked(creator, captionSubject(reel.dropId), now)) {
      counts.already += 1;
      continue;
    }
    persona ??= await deps.persona(creatorId);
    if (persona === null) return 'off';
    examples ??= await deps.examples(creatorId);
    const captions = await captionsFor(deps, persona, {
      creatorId,
      creatorName: persona.creatorName,
      personaSheet: persona.personaSheet,
      examples,
      mediaDescription: reel.description,
      durationS: reel.durationS,
      sentence: reel.sentence,
    });
    if (captions === 'budget') return 'budget';
    if (captions.length < DECISION_ANSWERS_MIN) {
      counts.refused += 1;
      continue;
    }
    const expiresAt = new Date(now.getTime() + ASKED_FOR_MS);
    await deps.asking.ask(creator, captionDecision(reel.dropId, captions, expiresAt));
    counts.asked += 1;
  }
  return counts;
}
