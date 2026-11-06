import { calendarDayAt, nextScriptDue, type CreatorId } from '@impera/contracts';

import { chooseStructure, scriptReason } from '../domain/cadence';
import { disgustBlocks } from '../domain/disgusts';
import type { CadenceStore, LimitsOf, ScriptRequests } from '../domain/ports';

export interface AskScriptsDeps {
  readonly cadences: CadenceStore;
  readonly requests: ScriptRequests;
  readonly limitsOf: LimitsOf;
}

/** What one run did, for the job's log line: counts only, never a name. */
export interface AskScriptsRun {
  readonly asked: number;
  /** Due, and nothing asked: no persona, nothing in her queue, or every structure touching her limits. */
  readonly warned: number;
  readonly failed: number;
}

type CreatorOutcome = 'asked' | 'warned' | 'not_due';

/**
 * `scripts.ask_scripts` (SC-02, ADR 0056 § 2), each hour: for each creator whose next script is due within the lead
 * (`nextScriptDue`, her own day), the first structure of her queue that touches none of her active persona's limits is
 * frozen and asked of her, then leaves her queue. Each step is replayable: the request is one per due day, a structure
 * already asked still in her queue (a run cut between the two) leaves it at the next run. One creator failing does not
 * stop the others: the next hour takes her again.
 */
export async function askScripts(deps: AskScriptsDeps, now: Date): Promise<AskScriptsRun> {
  let asked = 0;
  let warned = 0;
  let failed = 0;
  for (const creator of await deps.cadences.creators()) {
    try {
      const outcome = await askOne(deps, creator.id, calendarDayAt(now, creator.timeZone), now);
      if (outcome === 'asked') asked += 1;
      if (outcome === 'warned') warned += 1;
    } catch {
      failed += 1;
    }
  }
  return { asked, warned, failed };
}

async function askOne(
  deps: AskScriptsDeps,
  creatorId: CreatorId,
  today: string,
  now: Date,
): Promise<CreatorOutcome> {
  const { cadences, requests } = deps;
  const last = await requests.last(creatorId);
  const lastStructure = last === null ? null : await cadences.usable(creatorId, last.structureId);
  // A run cut after the request and before the queue: the structure asked leaves it now.
  if (last !== null && lastStructure !== null)
    await cadences.dequeue(creatorId, lastStructure.structureId, last.askedAt);
  const due = nextScriptDue(last?.dueOn ?? null, await cadences.days(creatorId), today);
  if (due === null) return 'not_due';

  const limits = await deps.limitsOf(creatorId);
  const choice = chooseStructure(await cadences.queue(creatorId), lastStructure, limits);
  if (choice.outcome !== 'asked' && choice.outcome !== 'reused') {
    await cadences.record(creatorId, choice.outcome, choice.skipped, now);
    return 'warned';
  }
  const version = await cadences.freeze(choice.structureId);
  // Archived meanwhile: the next run reads her queue again.
  if (version === null) return 'not_due';
  // Saved between the reading and the freezing: what is frozen is what is asked, so it is read again.
  const blocks = limits === null ? [] : disgustBlocks(version.segments, limits);
  if (blocks.length > 0) {
    await cadences.record(
      creatorId,
      'blocked',
      [...choice.skipped, { structureId: choice.structureId, name: version.name, blocks }],
      now,
    );
    return 'warned';
  }
  await requests.ask({
    creatorId,
    dueOn: due,
    reason: scriptReason(version.name),
    structureId: choice.structureId,
    structureVersionId: version.id,
  });
  if (choice.outcome === 'asked') await cadences.dequeue(creatorId, choice.structureId, null);
  await cadences.record(creatorId, choice.outcome, choice.skipped, now);
  return 'asked';
}
