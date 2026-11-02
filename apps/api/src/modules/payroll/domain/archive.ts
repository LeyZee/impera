/**
 * The archive of the documents' PDFs for the accountant (EQ-06 lot 7d), the pure rules: what each entry is named, and
 * the manifest that says what the archive holds. The bytes are read and zipped by `application/accounting.ts`.
 */

/** What became of a document in the archive. */
type ArchiveEntryState = 'archived' | 'not_rendered' | 'unreadable';

/** A document of the range, as the manifest lists it. */
export interface ArchiveEntry {
  /** `PRÉFIXE-AAAA-NNNN`: the prefix is the contractor's code, never their name. */
  readonly number: string;
  readonly kind: 'invoice' | 'credit_note';
  /** An invoice that bills again a cancelled one (ADR 0040). */
  readonly corrective: boolean;
  readonly issuedOn: string;
  /** The fingerprint the base records, `null` while the PDF is not rendered. */
  readonly sha256: string | null;
  readonly state: ArchiveEntryState;
}

/** The file of a document in the archive: its number, unique among all documents. */
export const archiveEntryName = (number: string): string => `${number}.pdf`;

/** The manifest's name in the archive, beside the PDFs. */
export const ARCHIVE_MANIFEST_NAME = 'manifeste.csv';

/** The archive's name: the range, never a contractor's name. */
export const archiveFileName = (from: string, to: string): string =>
  `pieces-prestataires_${from.replaceAll('-', '')}_${to.replaceAll('-', '')}.zip`;

const NATURES = { invoice: 'Facture', corrective: 'Facture rectificative', credit_note: 'Avoir' } as const;

const STATES: Readonly<Record<ArchiveEntryState, string>> = {
  archived: 'archivé',
  not_rendered: 'PDF pas encore rendu',
  unreadable: 'PDF illisible chez les deux hébergeurs, propriétaire alerté',
};

const COLUMNS = ['Numéro', 'Nature', 'Émise le', 'Fichier', 'Empreinte SHA-256', 'État'] as const;

/** A day as a French spreadsheet reads it: JJ/MM/AAAA. */
const frenchDay = (day: string): string => day.split('-').toReversed().join('/');

/**
 * The manifest: one line per document of the range in the order of the archive, its file when it holds it and the
 * fingerprint to check it against, or why it does not. Separated by semicolons, lines ended by CRLF, in UTF-8 with
 * its byte order mark. No cell needs quoting: numbers, days, fingerprints and the words above hold no separator.
 */
export function archiveManifest(entries: readonly ArchiveEntry[]): string {
  const rows = entries.map((entry) =>
    [
      entry.number,
      entry.kind === 'credit_note'
        ? NATURES.credit_note
        : entry.corrective
          ? NATURES.corrective
          : NATURES.invoice,
      frenchDay(entry.issuedOn),
      entry.state === 'archived' ? archiveEntryName(entry.number) : '',
      entry.sha256 ?? '',
      STATES[entry.state],
    ].join(';'),
  );
  return `\uFEFF${[COLUMNS.join(';'), ...rows].join('\r\n')}\r\n`;
}
