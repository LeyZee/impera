import type { ContentDropFile, ScriptSlot, ScriptSlotKey } from '@impera/contracts';

/** The slot named `key` among her script's, `undefined` when there is none. */
export function slotOf(slots: readonly ScriptSlot[], key: string): ScriptSlot | undefined {
  return slots.find((slot) => slot.key === key);
}

/**
 * The slots that keep « Envoyer le script » refused (SC-02 lot b): each slot she may not leave out with no file in
 * it, or with its file refused. A file still going up counts: it is hers, its bytes follow once she sends.
 */
export function requiredSlotsMissing(
  slots: readonly ScriptSlot[],
  files: readonly ContentDropFile[],
): ScriptSlotKey[] {
  const filled = new Set(
    files
      .filter((file) => file.state !== 'refused')
      .flatMap((file) => (file.slotKey === null ? [] : [file.slotKey])),
  );
  return slots.filter((slot) => !slot.slot.optional && !filled.has(slot.key)).map((slot) => slot.key);
}
