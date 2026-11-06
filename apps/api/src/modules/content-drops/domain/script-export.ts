import {
  scriptSegmentCodes,
  type ScriptSegment,
  type ScriptVariantLetter,
  type ShotMoment,
} from '@impera/contracts';

import { scriptFileName, scriptFolderEntries, scriptFolderName } from './script-naming';

/**
 * A sent script's folder as an archive (SC-03, ADR 0056 § 7): what goes in, in the script's order, under the names of
 * the naming, and the sheet the team copies into Reveal while the connector cannot write there. Pure: the store gives
 * the files, the library the cards, the route streams the bytes.
 */

/** A file of her sent script, as the store reads it: its slot, its kept medium's type, size and storage key. */
export interface ExportedFile {
  readonly slotKey: string;
  /** The kept medium's type (a converted video is `video/mp4`), not the one her phone declared. */
  readonly mime: string;
  readonly bytes: number;
  readonly storageKey: string;
}

type ExportSource =
  | {
      readonly kind: 'card';
      readonly segmentKey: string;
      readonly variant: ScriptVariantLetter | null;
    }
  | { readonly kind: 'file'; readonly storageKey: string; readonly bytes: number };

interface ExportEntry {
  /** Its path in the archive: `S014-nuit-salon/03-E2A-01-photo.jpg`. */
  readonly path: string;
  readonly source: ExportSource;
}

export interface ScriptExportPlan {
  readonly folder: string;
  /** The sheet first (`00-fiche.txt`), then each entry in the script's order. */
  readonly sheetPath: string;
  readonly sheet: string;
  readonly entries: readonly ExportEntry[];
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/3gpp': '3gp',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  'video/x-msvideo': 'avi',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/x-m4a': 'm4a',
};

/**
 * What the media of one archive may weigh (relecture Bilan de #607): the ZIP is written without ZIP64, its sizes and
 * offsets on 4 bytes, so past 4 Gio it would come out corrupt with a 200. The cards and the headers keep 256 Mio.
 */
const SCRIPT_EXPORT_MAX_BYTES = 4 * 1024 ** 3 - 256 * 1024 ** 2;

/** Whether her script's media fit in one archive. */
export const fitsInOneArchive = (files: readonly ExportedFile[]): boolean =>
  files.reduce((total, file) => total + file.bytes, 0) <= SCRIPT_EXPORT_MAX_BYTES;

/** A medium's extension by its type; `bin` for a type the drops never keep. */
export const extensionOf = (mime: string): string => EXTENSIONS[mime] ?? 'bin';

const ACCESS: Readonly<Record<'free' | 'paid', string>> = { free: 'GRATUIT', paid: 'PAYANT' };

/**
 * The sheet to copy, step by step: each segment with its code, its name and what it sells (or the bridge's teaser),
 * each series' hint, and the files in their order. The texts and the prices are not in it yet: they come with the
 * sales texts (SC-05) and the agency's price grid (P6-01), never invented here.
 */
function sheetOf(
  folder: string,
  name: string,
  segments: readonly ScriptSegment[],
  paths: readonly {
    readonly segmentKey: string;
    readonly variant: ScriptVariantLetter | null;
    readonly name: string;
  }[],
): string {
  const lines = [
    `Script ${folder}`,
    `Structure : ${name}`,
    '',
    'À recopier dans Reveal, dans cet ordre.',
    '',
  ];
  const codes = scriptSegmentCodes(segments);
  segments.forEach((segment, index) => {
    const head = codes[index];
    const position = String(head?.position ?? index + 1).padStart(2, '0');
    if (segment.kind === 'stage') {
      const code = head?.code ?? '?';
      lines.push(
        `${position} · ${code} — ${segment.name} (${ACCESS[segment.access]})`,
        `   ${segment.intention}`,
      );
    } else {
      lines.push(`${position} · ${head?.code ?? 'P?'} — Pont (GRATUIT)`, `   ${segment.teaser}`);
    }
    const series: readonly (ScriptVariantLetter | null)[] =
      segment.kind === 'stage' && segment.variants.length > 0
        ? segment.variants.map((variant) => variant.letter)
        : [null];
    for (const variant of series) {
      const hint =
        segment.kind === 'stage' && variant !== null
          ? segment.variants.find((one) => one.letter === variant)?.hint
          : undefined;
      if (hint !== undefined) lines.push(`   Série ${variant ?? ''} : ${hint}`);
      for (const one of paths)
        if (one.segmentKey === segment.key && one.variant === variant) lines.push(`     ${one.name}`);
    }
    lines.push('');
  });
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * The archive of her sent script: its folder named by her script number, the moment it was shot as and its
 * structure's name; each card at `00` of its series when the agency puts them in the folder; each live file under its
 * slot's name. A slot she left empty (an optional one) has no entry. A file for a slot the version does not have is
 * left out: the version is the order.
 */
export function scriptExportPlan(input: {
  readonly number: number;
  readonly moment: ShotMoment;
  readonly version: { readonly name: string; readonly segments: readonly ScriptSegment[] };
  readonly files: readonly ExportedFile[];
  readonly cards: boolean;
}): ScriptExportPlan {
  const folder = scriptFolderName(input.number, input.moment, input.version.name);
  const bySlot = new Map(input.files.map((file) => [file.slotKey, file]));
  const entries: ExportEntry[] = [];
  const named: { segmentKey: string; variant: ScriptVariantLetter | null; name: string }[] = [];
  for (const entry of scriptFolderEntries(input.version.segments, { cards: input.cards })) {
    if (entry.slotKey === null) {
      const name = scriptFileName(entry, 'png');
      entries.push({
        path: `${folder}/${name}`,
        source: { kind: 'card', segmentKey: entry.segmentKey, variant: entry.variant },
      });
      named.push({ segmentKey: entry.segmentKey, variant: entry.variant, name });
      continue;
    }
    const file = bySlot.get(entry.slotKey);
    if (file === undefined) continue;
    const name = scriptFileName(entry, extensionOf(file.mime));
    entries.push({
      path: `${folder}/${name}`,
      source: { kind: 'file', storageKey: file.storageKey, bytes: file.bytes },
    });
    named.push({ segmentKey: entry.segmentKey, variant: entry.variant, name });
  }
  const sheetPath = `${folder}/00-fiche.txt`;
  return {
    folder,
    sheetPath,
    sheet: sheetOf(folder, input.version.name, input.version.segments, named),
    entries,
  };
}
