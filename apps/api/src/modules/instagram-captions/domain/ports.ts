import type { CreatorId, NewCreatorDecision } from '@impera/contracts';

import type { WrittenCaption } from './proposals';

/** A live drop of hers and what the vision AI saw in its medium, as `content-drops` gives it. */
export interface DescribedReel {
  readonly dropId: string;
  readonly category: string;
  readonly description: string;
  /** What she wrote with her drop: her own free text, a data for the model. */
  readonly sentence: string | null;
  readonly durationS: number | null;
}

/** Who she is for a caption: her public panels, and the guards of her voice on a public text. */
export interface CaptionPersona {
  readonly creatorName: string;
  readonly personaSheet: string;
  /** The names of the blocking guards a text raises; empty when it passes. */
  blocking(text: string): readonly string[];
}

export interface CaptionRequest {
  readonly creatorId: string;
  readonly creatorName: string;
  readonly personaSheet: string;
  readonly examples: readonly string[];
  readonly mediaDescription: string;
  readonly durationS: number | null;
  readonly sentence: string | null;
  /** What refused captions of a first answer: rule names only. */
  readonly refusedBy?: readonly string[];
}

/** The model that writes: its captions, `budget` when the day's cap is spent, `failed` when every model failed. */
export interface CaptionWriter {
  write(request: CaptionRequest): Promise<readonly WrittenCaption[] | 'budget' | 'failed'>;
}

/** The door of `creator-decisions`, as this module uses it. */
export interface CaptionAsking {
  ask(creatorId: CreatorId, decision: NewCreatorDecision): Promise<boolean>;
  asked(creatorId: CreatorId, subject: string, now: Date): Promise<boolean>;
}

export interface ProposeDeps {
  /** The live drops that hold this medium, described; empty while it is not. */
  readonly drops: (creatorId: string, mediaAssetId: string) => Promise<readonly DescribedReel[]>;
  /** `null`: no active persona, nothing is written in her name. */
  readonly persona: (creatorId: string) => Promise<CaptionPersona | null>;
  /** Her past captions that did well, the most recent first; empty until her account is read. */
  readonly examples: (creatorId: string) => Promise<readonly string[]>;
  readonly writer: CaptionWriter;
  readonly asking: CaptionAsking;
}
