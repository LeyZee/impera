import { JOB_PAYLOADS, KycSlotSchema } from '@impera/contracts';

import { defineTask } from '../jobs';
import { enqueueFanNoteSync, type FanNoteSource, type NoteSlotValue } from '../modules/connectors';
import { createFansModule, type FansModule } from '../modules/fans';

import type { Routes, Shared, TasksNamed } from './shared';

type KycSlotsOf = NonNullable<Parameters<FansModule['routes']>[1]>;
type FanAccess = NonNullable<Parameters<FansModule['routes']>[2]>;
type UsdRateMicrosOf = NonNullable<Parameters<FansModule['routes']>[3]>;

export interface WiredFans {
  readonly module: FansModule;
  /** `fans.read_card` is the conversations' file's: his messages are read where they are kept (ADR 0085 § 7). */
  readonly tasks: TasksNamed<'fans.purge_facts'>;
  /**
   * Her canvas lines come from the agent, and who holds a fan's conversation and the trace of a chatter's reading from
   * `conversations`, and pay's dollar rate for the list of fans (ADR 0124) from `payroll`, all wired after: the routes
   * are built once they exist.
   */
  routes(kycSlotsOf: KycSlotsOf, fanAccess: FanAccess, usdRateMicrosOf: UsdRateMicrosOf): Routes;
}

export function wireFans(shared: Shared): WiredFans {
  const { db, adminDb, logger, requireRole } = shared;
  const module = createFansModule({
    db,
    adminDb,
    // His note on the platform follows his facts (ADR 0117 § 5); a failure to queue leaves the facts written.
    onFactsChanged: async (creatorId, fanId) => {
      try {
        await enqueueFanNoteSync(adminDb, creatorId, fanId, `fan-note:${fanId}`);
      } catch (error) {
        logger.warn({ err: error, creatorId, fanId }, 'fans: fan note sync not queued');
      }
    },
  });
  return {
    module,
    tasks: {
      'fans.purge_facts': defineTask(
        'fans.purge_facts',
        JOB_PAYLOADS['fans.purge_facts'],
        logger,
        async (_payload, context) => {
          context.logger.info(
            { removed: await module.jobs.purgeFacts() },
            'fans: facts past retention dropped',
          );
        },
      ),
    },
    routes: (kycSlotsOf, fanAccess, usdRateMicrosOf) =>
      module.routes(requireRole, kycSlotsOf, fanAccess, usdRateMicrosOf),
  };
}

/**
 * What `connector.sync_fan_note` reads of a fan (ADR 0117 § 4): his platform ids and the canvas fields of his card he
 * said himself or a chatter noted; a guess never leaves Impera, nor his age while it is disputed (relecture d'Agent, #775).
 */
export function fanNoteSourceOf(fans: Pick<FansModule, 'getFan' | 'card' | 'flags'>): FanNoteSource {
  return {
    read: async (creatorId, fanId) => {
      const fan = await fans.getFan(creatorId, fanId);
      if (fan === null) return null;
      const card = await fans.card(creatorId, fanId);
      // While his age is disputed, a human settles it: the Âge line is neither filled, completed nor corrected.
      const ageDisputed = (await fans.flags(creatorId, fanId)).ageDisputed !== undefined;
      const values = card.fields.flatMap((entry): NoteSlotValue[] => {
        const slot = KycSlotSchema.safeParse(entry.field);
        const value = entry.current;
        if (!slot.success || value === null || value.source === 'inferred') return [];
        if (slot.data === 'age' && ageDisputed) return [];
        return [{ slot: slot.data, items: value.items, source: value.source, observedAt: value.observedAt }];
      });
      return { platformAccountId: fan.platformAccountId, platformFanId: fan.platformFanId, values };
    },
  };
}
