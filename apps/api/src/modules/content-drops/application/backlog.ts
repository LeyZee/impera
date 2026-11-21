import type { DescriptionBacklog, DropDescriber, ScriptSummarizer } from '../domain/ports';

export interface BacklogDeps {
  readonly backlog: DescriptionBacklog;
  readonly describer: Pick<DropDescriber, 'promptHash'>;
  readonly summarizer: Pick<ScriptSummarizer, 'promptHash'>;
}

/**
 * `content_drops.describe_backlog` (ADR 0083 § 2): each hour, what of her drops waits for a description or a synthesis
 * of the prompts of now is enqueued again: media whose job was lost, media described with an older prompt (never over
 * a human's), scripts whose synthesis is older than a description of theirs. A drop is described on arrival, with no
 * switch (ADR 0145 § 5, 17/11: the drop is the choice); the vault is not, it waits for the owner's request. Counts.
 */
export function describeBacklog(
  deps: BacklogDeps,
  creatorId: string | null,
  correlationId: string,
): Promise<{ readonly media: number; readonly scripts: number }> {
  return deps.backlog.enqueue(
    creatorId,
    { describe: deps.describer.promptHash, summarize: deps.summarizer.promptHash },
    correlationId,
  );
}
