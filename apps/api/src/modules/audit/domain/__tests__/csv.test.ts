import { AuditEntryIdSchema, type AuditEntry } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { AUDIT_CSV_COLUMNS, auditCsv, csvCell } from '../csv';

describe('the export of the journal (EQ-18)', () => {
  it('never lets a spreadsheet read a cell as a formula', () => {
    expect(csvCell('=HYPERLINK("https://example.test","clic")')).toBe(
      '"\'=HYPERLINK(""https://example.test"",""clic"")"',
    );
    expect(csvCell('+33 6 00 00 00 00')).toBe('"\'+33 6 00 00 00 00"');
    expect(csvCell('-2+3')).toBe('"\'-2+3"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(csvCell('\t=1')).toBe('"\'\t=1"');
    expect(csvCell('a validé un relevé')).toBe('"a validé un relevé"');
  });

  it('keeps each cell on one line and its separators inside quotes', () => {
    expect(csvCell('une; deux\r\ntrois "quatre"')).toBe('"une; deux trois ""quatre"""');
  });

  it('writes the columns, then one line per entry, in the order given', () => {
    const entry = (id: string, name: string | null): AuditEntry => ({
      id: AuditEntryIdSchema.parse(id),
      at: '2026-11-20T10:00:00.000Z',
      author: name === null ? null : { userId: '0195f0c0-0000-7000-8000-0000000000b1', name },
      action: 'bonus.create',
      category: 'money',
      label: 'a accordé une prime pour la quinzaine du 1er au 15 novembre 2026',
      link: null,
    });
    const file = auditCsv([
      entry('0195f0c0-0000-7000-8000-000000000002', '=Nora'),
      entry('0195f0c0-0000-7000-8000-000000000001', null),
    ]);
    expect(file.startsWith('\uFEFF')).toBe(true);
    const lines = file.slice(1).split('\r\n');
    expect(lines).toEqual([
      AUDIT_CSV_COLUMNS.map((c) => `"${c}"`).join(';'),
      '"0195f0c0-0000-7000-8000-000000000002";"2026-11-20T10:00:00.000Z";"\'=Nora";"0195f0c0-0000-7000-8000-0000000000b1";"Argent";"bonus.create";"a accordé une prime pour la quinzaine du 1er au 15 novembre 2026";"";""',
      '"0195f0c0-0000-7000-8000-000000000001";"2026-11-20T10:00:00.000Z";"Impera";"";"Argent";"bonus.create";"a accordé une prime pour la quinzaine du 1er au 15 novembre 2026";"";""',
      '',
    ]);
  });
});
