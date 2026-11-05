import { DROP_PART_BYTES, dropPartCount } from '@impera/contracts';

/**
 * Where a file's raw bytes land (ADR 0055 § 3): a prefix of their own, that only the cleaning reads, that the storage
 * empties after 24 hours whatever happened (runbook deploy.md § Stockage des médias). Her creator, then the file: the
 * name of her original never appears.
 */
export const rawKeyOf = (creatorId: string, fileId: string): string => `incoming/${creatorId}/${fileId}`;

export interface PlannedPart {
  readonly number: number;
  readonly bytes: number;
}

/** The parts a file of `bytes` goes up in, numbered from 1: `DROP_PART_BYTES` each, the last one the rest. */
export function partPlan(bytes: number): PlannedPart[] {
  const count = dropPartCount(bytes);
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    bytes: index < count - 1 ? DROP_PART_BYTES : bytes - DROP_PART_BYTES * (count - 1),
  }));
}

export interface StoredPart {
  readonly number: number;
  readonly etag: string;
  readonly bytes: number;
}

/**
 * The parts still to send: those the storage does not hold whole. A part of another size than planned (a phone that
 * cut it in other pieces) is sent again; a part the storage holds beyond the plan is ignored.
 */
export function partsSplit(
  bytes: number,
  stored: readonly StoredPart[],
): { readonly missing: PlannedPart[]; readonly kept: StoredPart[] } {
  const missing: PlannedPart[] = [];
  const kept: StoredPart[] = [];
  for (const part of partPlan(bytes)) {
    const held = stored.find((one) => one.number === part.number && one.bytes === part.bytes);
    if (held === undefined) missing.push(part);
    else kept.push(held);
  }
  return { missing, kept };
}

/**
 * Why the parts named to finish a file are not its whole, in her words; `null` when they are: each number of the plan
 * once, nothing else.
 */
export function completionRefusal(
  bytes: number,
  parts: readonly { readonly number: number }[],
): string | null {
  const numbers = parts.map((part) => part.number).sort((a, b) => a - b);
  const whole =
    numbers.length === dropPartCount(bytes) && numbers.every((number, index) => number === index + 1);
  return whole ? null : 'Il manque une partie du fichier : relance l’envoi';
}
