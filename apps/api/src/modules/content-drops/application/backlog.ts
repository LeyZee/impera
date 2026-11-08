import type { DescriptionBacklog, DropDescriber, ScriptSummarizer } from '../domain/ports';

export interface BacklogDeps {
  readonly backlog: DescriptionBacklog;
  readonly describer: Pick<DropDescriber, 'promptHash'>;
  readonly summarizer: Pick<ScriptSummarizer, 'promptHash'>;
}

/**
 * `content_drops.describe_backlog` (ADR 0083 § 2, § 9): each hour for every creator whose switch is on, and at once
 * for one when it is turned on, what waits for a description or a synthesis of the prompts of now is enqueued again.
 * Media dropped while her switch was off, media described with an older prompt (never over a human's), scripts whose
 * synthesis is older than a description of theirs. Counts only.
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
