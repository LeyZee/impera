import type { CreatorId, FanId, JobPayload, PlatformAccountId } from '@impera/contracts';

import { SendRefused } from '../../conversations';
import { canvasLinesOf, planAgencyNote, type LineSigner, type NoteSlotValue } from '../domain/agency-note';
import type { AccountStore, Clock, JobLogger, NoteLineStore } from '../domain/ports';

import type { ConnectorWrites } from './outbound-sender';

/** What the job reads of the fan (the `fans` module, through the composition root): who he is, his card's values. */
export interface FanNoteSource {
  read(
    creatorId: CreatorId,
    fanId: FanId,
  ): Promise<{
    readonly platformAccountId: PlatformAccountId;
    readonly platformFanId: string;
    /** His card's values he said or a chatter noted in the CRM (ADR 0117 § 4); never a guess. */
    readonly values: readonly NoteSlotValue[];
  } | null>;
}

export interface FanNoteDeps {
  readonly accounts: Pick<AccountStore, 'get'>;
  readonly lines: NoteLineStore;
  readonly fans: FanNoteSource;
  readonly writes: Pick<ConnectorWrites, 'readFanNote' | 'writeFanNote'>;
  readonly clock: Clock;
  /** The keyed marks of an account's lines; `null` without a session key, and then nothing is written. */
  readonly signerFor: (platformAccountId: string) => LineSigner | null;
}

/**
 * `connector.sync_fan_note` (ADR 0117 §§ 3–5): his note read live, the canvas lines planned against what the agent
 * remembers writing, then written through the write guard. Nothing of the note is logged nor kept: the slots written
 * and their keyed marks only. A closed guard is a skip, never a failure.
 */
export function createFanNoteJob(deps: FanNoteDeps) {
  return async (payload: JobPayload<'connector.sync_fan_note'>, logger: JobLogger): Promise<void> => {
    const now = deps.clock.now();
    const fan = await deps.fans.read(payload.creatorId, payload.fanId);
    if (fan === null || fan.values.length === 0) {
      logger.info(
        { fanId: payload.fanId, reason: fan === null ? 'unknown fan' : 'nothing known' },
        'fan note: skipped',
      );
      return;
    }
    const account = await deps.accounts.get(payload.creatorId, fan.platformAccountId);
    if (account === null || (account.sessionState !== 'valid' && account.sessionState !== 'warning')) {
      const reason = account === null ? 'unknown account' : `session ${account.sessionState}`;
      logger.info({ fanId: payload.fanId, reason }, 'fan note: skipped');
      return;
    }
    if (!account.config.writes) {
      logger.info({ fanId: payload.fanId, reason: 'writes off' }, 'fan note: skipped');
      return;
    }
    const signer = deps.signerFor(account.id);
    if (signer === null) {
      logger.info({ fanId: payload.fanId, reason: 'no session key' }, 'fan note: skipped');
      return;
    }
    const target = {
      creatorId: account.creatorId,
      platformAccountId: account.id,
      platformFanId: fan.platformFanId,
    };
    const note = await deps.writes.readFanNote(target);
    const memory = await deps.lines.lines(account, fan.platformFanId);
    const plan = planAgencyNote({ note, values: fan.values, memory, now, signer });
    if (plan.block !== '') {
      try {
        await deps.writes.writeFanNote(
          target,
          plan.block,
          `fan-note:${fan.platformFanId}:${signer.sign(plan.block)}`,
        );
      } catch (error) {
        if (!(error instanceof SendRefused)) throw error;
        logger.info({ fanId: payload.fanId, reason: error.code }, 'fan note: skipped');
        return;
      }
    }
    if (plan.memory.length > 0) await deps.lines.remember(account, fan.platformFanId, plan.memory, now);
    // ADR 0117 § 1: each line written, with where its value comes from; never the value nor the note.
    const written = [...canvasLinesOf(plan.block).keys()].map((slot) => ({
      slot,
      source: fan.values.find((value) => value.slot === slot)?.source,
    }));
    logger.info(
      { fanId: payload.fanId, lines: written },
      plan.block === '' ? 'fan note: up to date' : 'fan note: written',
    );
  };
}
