import { describe, expect, it } from 'vitest';

import { ARCHIVE_MANIFEST_NAME, archiveEntryName, archiveFileName, archiveManifest } from '../archive';

describe('the archive of the PDFs (EQ-06 lot 7d)', () => {
  it('names each file by its number and the archive by its range, never by a contractor', () => {
    expect(archiveEntryName('NORA-2026-0001')).toBe('NORA-2026-0001.pdf');
    expect(archiveFileName('2026-10-01', '2026-10-31')).toBe('pieces-prestataires_20261001_20261031.zip');
    expect(ARCHIVE_MANIFEST_NAME).toBe('manifeste.csv');
  });

  it('lists every document of the range in its manifest, the ones it could not archive too', () => {
    const fingerprint = 'a'.repeat(64);
    const text = archiveManifest([
      {
        number: 'NORA-2026-0001',
        kind: 'invoice',
        corrective: false,
        issuedOn: '2026-10-02',
        sha256: fingerprint,
        state: 'archived',
      },
      {
        number: 'NORA-2026-0002',
        kind: 'credit_note',
        corrective: false,
        issuedOn: '2026-10-09',
        sha256: 'b'.repeat(64),
        state: 'unreadable',
      },
      {
        number: 'NORA-2026-0003',
        kind: 'invoice',
        corrective: true,
        issuedOn: '2026-10-09',
        sha256: null,
        state: 'not_rendered',
      },
      {
        number: 'NORA-2026-0004',
        kind: 'invoice',
        corrective: false,
        issuedOn: '2026-10-16',
        sha256: 'c'.repeat(64),
        state: 'unreachable',
      },
      // Recette EQP-09: lost with a development server's memory, never « relancer l'export ».
      {
        number: 'NORA-2026-0005',
        kind: 'invoice',
        corrective: false,
        issuedOn: '2026-10-23',
        sha256: 'd'.repeat(64),
        state: 'forgotten',
      },
    ]);
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.slice(1, -2).split('\r\n')).toEqual([
      'Numéro;Nature;Émise le;Fichier;Empreinte SHA-256;État',
      `NORA-2026-0001;Facture;02/10/2026;NORA-2026-0001.pdf;${fingerprint};archivé`,
      `NORA-2026-0002;Avoir;09/10/2026;;${'b'.repeat(64)};PDF faux à la relecture, propriétaire alerté`,
      'NORA-2026-0003;Facture rectificative;09/10/2026;;;PDF pas encore rendu',
      `NORA-2026-0004;Facture;16/10/2026;;${'c'.repeat(64)};hébergeurs injoignables, relancer l'export`,
      `NORA-2026-0005;Facture;23/10/2026;;${'d'.repeat(64)};PDF perdu au redémarrage du serveur de développement, jamais refait`,
    ]);
    expect(archiveManifest([])).toBe('\uFEFFNuméro;Nature;Émise le;Fichier;Empreinte SHA-256;État\r\n');
  });
});
