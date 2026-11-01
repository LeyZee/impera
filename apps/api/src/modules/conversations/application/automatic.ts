import {
  automaticGate,
  BLIND_TEST_TARGET,
  liveRate,
  type AutomaticGate,
  type CreatorId,
  type LiveRateReading,
} from '@nirvana/contracts';

import type { DraftVoice, EventMeta, Transaction, UnitOfWork } from '../domain/ports';

import { appendEvent, lockConversation } from './journal';

/**
 * The server lock of Automatique (ADR 0019): the one place that reads it. The rule itself is in contracts; the
 * evidence (decided drafts, blind tests) is read here, for the voice version the server writes with now.
 */
export async function readAutomaticGate(tx: Transaction, voice: DraftVoice): Promise<AutomaticGate> {
  return (await readAutomaticLock(tx, voice)).gate;
}

/** The lock and the live rate it was decided on: the Dashboard shows that rate, not one read apart. */
export async function readAutomaticLock(
  tx: Transaction,
  voice: DraftVoice,
): Promise<{ readonly gate: AutomaticGate; readonly reading: LiveRateReading }> {
  const reading = liveRate(await tx.automatic.decided(voice));
  const blindTest = await tx.automatic.latestBlindTest(voice);
  const gate = automaticGate({
    personaActive: await tx.automatic.personaActive(),
    reading,
    blindTestPassed: blindTest !== null && blindTest >= BLIND_TEST_TARGET * 10,
  });
  return { gate: { open: gate.open, missing: [...gate.missing] }, reading };
}

/**
 * Brings every conversation in automatic back to the copilot when the lock has closed (the live rate fell, or the
 * voice changed and has proved nothing yet), and tells the owner once with `automatic_closed`. Its own transaction,
 * the creator's lock first and then each conversation's, the order every mode change takes: never called while a
 * conversation is locked. Returns whether it closed anything.
 */
export function closeAutomaticIfLocked(
  uow: UnitOfWork,
  creatorId: CreatorId,
  voice: DraftVoice,
  meta: EventMeta,
): Promise<boolean> {
  return uow.inTenant(creatorId, async (tx) => {
    await tx.switches.lockCreator();
    const ids = await tx.conversations.idsInMode('auto');
    if (ids.length === 0) return false;
    const gate = await readAutomaticGate(tx, voice);
    if (gate.open) return false;
    let closed = 0;
    for (const id of ids) {
      const conversation = await lockConversation(tx, id);
      if (conversation.mode !== 'auto') continue;
      await appendEvent(
        tx,
        conversation,
        { type: 'mode_changed', payload: { mode: 'copilot', reason: 'Automatique refermé (ADR 0019)' } },
        meta,
      );
      closed += 1;
    }
    if (closed === 0) return false;
    await tx.events.publish(
      creatorId,
      {
        type: 'automatic_closed',
        payload: { ...voice, missing: gate.missing, conversations: closed },
      },
      meta,
    );
    return true;
  });
}
