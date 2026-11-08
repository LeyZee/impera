import { KYC_ASKABLE, KYC_SLOT_LABELS, type KycSlot } from '@impera/contracts';

/**
 * What she may ask him (ADR 0085 § 2): the six slots of `KYC_ASKABLE`. The rest of his card is noted when he talks
 * about it, or observed, never asked: a rule of code, whatever the brain names.
 */

const normalized = (word: string): string => word.trim().toLowerCase();

/** The slots she may ask about, by code and by the canvas line the prompt names them with (« Prénom »). */
const ASKABLE_WORDS = new Set(
  KYC_ASKABLE.flatMap((slot) => [normalized(slot), normalized(KYC_SLOT_LABELS[slot])]),
);

/** Her canvas lines, in her order, without those never asked: what the brain's prompt reads. */
export function askableSlots(collect: readonly KycSlot[]): KycSlot[] {
  return collect.filter((slot) => KYC_ASKABLE.includes(slot));
}

/** The brain's reading with only what she may ask left in `kycMissing`: the voice never brings up the rest. */
export function askableOnly<T extends { readonly kycMissing: readonly string[] }>(brief: T): T {
  return { ...brief, kycMissing: brief.kycMissing.filter((slot) => ASKABLE_WORDS.has(normalized(slot))) };
}
