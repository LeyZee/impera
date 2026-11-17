import { KYC_SLOT_LABELS, KycSlotSchema, type KycSlot } from '@impera/contracts';

/**
 * What the agent writes in the canvas lines of a fan's client note (ADR 0117 §§ 3–4). Pure: the job reads the note
 * and his card, this plans the lines, the connector writes them. The note itself is never kept: only a keyed mark
 * (HMAC) of each line the agent wrote last (`NoteLineMemory`), to know whether a human changed it since. A plain hash of
 * a line as short as « Âge : 25 » would give it back by trying values (relecture de Bilan, #775).
 */

/** A value of his card the note may carry: said by him (`declared`) or noted by a chatter in the CRM (`noted`). */
export interface NoteSlotValue {
  readonly slot: KycSlot;
  readonly items: readonly string[];
  readonly source: 'declared' | 'noted';
  readonly observedAt: Date;
}

/** What Impera keeps of a canvas line it wrote: never the line, its fingerprint. */
export interface NoteLineMemory {
  readonly slot: KycSlot;
  /** The keyed mark of the line as the agent wrote it last (`LineSigner`). */
  readonly hash: string;
  /** `agent`: the agent's own line, written into an empty one. `human`: a human's line it completed or corrected. */
  readonly owner: 'agent' | 'human';
  /** It corrected the human's value once (« (avant : …) »). */
  readonly corrected: boolean;
  /** A human changed the line after that correction: it is completed, never corrected again (§ 3). */
  readonly locked: boolean;
}

export interface AgencyNotePlan {
  /** The canvas lines to write (`Label : value`, one per line), empty when nothing changes. */
  readonly block: string;
  /** The memory of every line written by this plan, to keep once the write went through. */
  readonly memory: readonly NoteLineMemory[];
}

/** A human's line is corrected only on what he said himself in these last days (§ 3). */
export const CORRECTION_WINDOW_DAYS = 7;

/** Fields that hold one value: only these are ever corrected; a list is only completed. */
const ONE_VALUE: ReadonlySet<KycSlot> = new Set(['first_name', 'location', 'age', 'job', 'situation']);

const ITEM_SEPARATOR = ', ';

/** Marks a line with a key of the account, and tells whether a mark is this line's (the infra holds the key). */
export interface LineSigner {
  sign(line: string): string;
  signs(line: string, mark: string): boolean;
}

/** The line a mark is computed on: spaces folded, so that a stray space does not read as a human's change. */
export function markedText(line: string): string {
  return line.trim().replace(/\s+/gu, ' ');
}

/** Lowercase, without accents nor punctuation: « Lyon » and « lyon. » are the same word. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** One line, no line break, no « : » trick that would read as a second label. */
function clean(item: string): string {
  return item.replace(/\s+/gu, ' ').trim();
}

interface CanvasLine {
  readonly line: string;
  readonly value: string;
}

/** The first line of each canvas label in `note`, as `withAgencyBlock` reads them (label, any case, then « : »). */
export function canvasLinesOf(note: string): ReadonlyMap<KycSlot, CanvasLine> {
  const found = new Map<KycSlot, CanvasLine>();
  for (const line of note.split('\n')) {
    const match = /^\s*([^:\n]+?)\s*:(.*)$/u.exec(line);
    if (match === null) continue;
    const name = (match[1] ?? '').toLocaleLowerCase('fr');
    const slot = KycSlotSchema.options.find((one) => KYC_SLOT_LABELS[one].toLocaleLowerCase('fr') === name);
    if (slot === undefined || found.has(slot)) continue;
    found.set(slot, { line, value: (match[2] ?? '').trim() });
  }
  return found;
}

function lineOf(slot: KycSlot, value: string): string {
  return `${KYC_SLOT_LABELS[slot]} : ${value}`;
}

/** Each of the wanted items is already in the human's text (folded): nothing to add. */
function missingItems(current: string, items: readonly string[]): string[] {
  const folded = ` ${fold(current)} `;
  return items.filter((item) => {
    const word = fold(item);
    return word !== '' && !folded.includes(` ${word} `);
  });
}

/** The human's value says plainly something else: neither one holds the other (§ 3, « nettement »). */
function contradicts(current: string, wanted: string): boolean {
  const a = fold(current);
  const b = fold(wanted);
  if (a === '' || b === '') return false;
  return !` ${a} `.includes(` ${b} `) && !` ${b} `.includes(` ${a} `);
}

function recent(value: NoteSlotValue, now: Date): boolean {
  const age = now.getTime() - value.observedAt.getTime();
  return age >= 0 && age <= CORRECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * The canvas lines to write into `note` (ADR 0117 § 3):
 * - an empty line (absent, or its label alone) takes the card's value, and is the agent's;
 * - the agent's own line, untouched since (`hash`), follows the card;
 * - a human's line stays: a value he said himself completes it with what it lacks; it is corrected, with the old value
 *   kept on the line (« Paris (avant : Lyon) »), only when he said a plainly different one in the last
 *   `CORRECTION_WINDOW_DAYS` days, on a one-value field, and never twice once a human changed the correction;
 * - the « (avant : …) » of a correction is never taken away by the agent: only a human removes it.
 */
export function planAgencyNote(input: {
  readonly note: string;
  readonly values: readonly NoteSlotValue[];
  readonly memory: readonly NoteLineMemory[];
  readonly now: Date;
  readonly signer: LineSigner;
}): AgencyNotePlan {
  const lines = canvasLinesOf(input.note);
  const remembered = new Map(input.memory.map((one) => [one.slot, one]));
  const block: string[] = [];
  const memory: NoteLineMemory[] = [];

  function write(slot: KycSlot, line: string, state: Omit<NoteLineMemory, 'slot' | 'hash'>): void {
    block.push(line);
    memory.push({ slot, hash: input.signer.sign(line), ...state });
  }

  for (const slot of KycSlotSchema.options) {
    const value = input.values.find((one) => one.slot === slot);
    if (value === undefined) continue;
    const items = value.items.map(clean).filter((item) => item !== '');
    if (items.length === 0) continue;
    const wanted = items.join(ITEM_SEPARATOR);
    const current = lines.get(slot);
    const mine = remembered.get(slot);
    const untouched =
      current !== undefined && mine !== undefined && input.signer.signs(current.line, mine.hash);

    if (current === undefined || current.value === '' || (untouched && mine.owner === 'agent')) {
      const line = lineOf(slot, wanted);
      if (current?.line.trim() !== line)
        write(slot, line, { owner: 'agent', corrected: false, locked: false });
      continue;
    }

    // A human's line: one he wrote, or one the agent completed or corrected and he left as it was.
    const corrected = untouched && mine.corrected;
    const locked = mine !== undefined && (mine.locked || (!untouched && mine.corrected));
    const keep = { owner: 'human', corrected, locked } as const;
    const single = items[0];
    if (value.source === 'declared' && ONE_VALUE.has(slot) && single !== undefined) {
      if (!corrected && !locked && recent(value, input.now) && contradicts(current.value, single)) {
        write(slot, lineOf(slot, `${single} (avant : ${current.value})`), { ...keep, corrected: true });
        continue;
      }
      if (
        !corrected &&
        fold(single).length > fold(current.value).length &&
        ` ${fold(single)} `.includes(` ${fold(current.value)} `)
      ) {
        write(slot, lineOf(slot, single), keep);
        continue;
      }
    }
    const missing =
      value.source === 'declared' && !ONE_VALUE.has(slot) ? missingItems(current.value, items) : [];
    if (missing.length > 0) {
      write(slot, lineOf(slot, [current.value, ...missing].join(ITEM_SEPARATOR)), keep);
    } else if (mine !== undefined && locked !== mine.locked) {
      memory.push({ ...mine, locked });
    }
  }
  return { block: block.join('\n'), memory };
}
