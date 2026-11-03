import { fileURLToPath } from 'node:url';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';

import { TRANSPARENT_KINDS } from '../../../contractors/infra/__tests__/invented-png';
import {
  frenchCharged,
  frenchFranchise,
  REGIME_MENTIONS,
  sampleCorrectiveInvoice,
  sampleCreditNote,
  sampleInvoice,
  worstCase,
} from '../../domain/__tests__/invoice-pdf-fixtures';
import { InvoicePdfGlyphMissing } from '../../domain/errors';
import { invoicePdfContent, type InvoicePdfContent } from '../../domain/invoice-pdf';
import type { InvoiceLogo, InvoicePdfRenderer } from '../../domain/ports';
import { createPdfkitInvoiceRenderer, loadInvoiceFonts } from '../invoice-pdf-renderer';

import { inventedLogo } from './invented-logo';

const FONTS_DIR = fileURLToPath(new URL('../fonts/', import.meta.url));
const ISSUED_AT = new Date('2026-11-17T08:12:00.000Z');

/** A text without its spaces nor its case: what a line break, a no-break space or capitals do not change. */
const squeeze = (text: string): string => text.replace(/\s+/gu, '').toLocaleLowerCase('fr');

/** The text of each page, as a reader extracts it (pdf.js): the fonts' ToUnicode maps must give the words back. */
async function itemsOf(bytes: Uint8Array): Promise<string[][]> {
  const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
  const pdf = await task.promise;
  const pages: string[][] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const text = await (await pdf.getPage(number)).getTextContent();
    pages.push(
      text.items.map((item) => ('str' in item ? item.str : '')).filter((item) => item.trim() !== ''),
    );
  }
  await task.destroy();
  return pages;
}

async function pagesOf(bytes: Uint8Array): Promise<string[]> {
  return (await itemsOf(bytes)).map((items) => items.join(' '));
}

const ascii = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

// Each test lays out real pages, then reads them back with pdf.js: seconds, not milliseconds, under a loaded machine.
describe('Équipe › Factures : le PDF rendu (EQ-06 lot 4, ADR 0037 § 2)', { timeout: 30_000 }, () => {
  let renderer: InvoicePdfRenderer;
  const render = (content: InvoicePdfContent, logo: InvoiceLogo | null = null) =>
    renderer.render(content, logo, ISSUED_AT);

  beforeAll(() => {
    renderer = createPdfkitInvoiceRenderer(loadInvoiceFonts(FONTS_DIR));
  });

  it('renders the invoice as a PDF/A-3b, the same bytes every time', async () => {
    const content = invoicePdfContent(sampleInvoice());
    const first = await render(content);
    const second = await render(content);
    expect(ascii(first.subarray(0, 8))).toBe('%PDF-1.7');
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    const text = ascii(first);
    expect(text).toMatch(/<pdfaid:part>3<\/pdfaid:part>/u);
    expect(text).toMatch(/<pdfaid:conformance>B<\/pdfaid:conformance>/u);
    // The fonts are embedded, an sRGB output intent declared, and the document's instant is its only date.
    expect(text).toMatch(/\/FontFile2/u);
    expect(text).toMatch(/\/OutputIntents/u);
    expect(text).toContain('D:20261117081200Z');
  });

  it('prints every word of the invoice on its first page, and the statement on the second', async () => {
    const content = invoicePdfContent(sampleInvoice());
    const pages = await pagesOf(await render(content));
    expect(pages).toHaveLength(2);
    const [first = '', annex = ''] = pages.map(squeeze);
    const words = [
      content.heading,
      content.number,
      content.badge,
      content.brandNote,
      ...content.meta.flatMap((one) => [one.label, one.value]),
      ...content.parties.flatMap((party) => [
        party.label,
        party.name,
        ...party.lines,
        ...party.ids.map((id) => id.value),
      ]),
      ...content.object.map((one) => `${one.lead ?? ''}${one.text}`),
      ...content.lines.rows.flatMap((row) => [row.label, row.detail ?? '', row.amount]),
      content.vatNote.lead,
      content.vatNote.text,
      content.vatNote.currency,
      ...content.totals.flatMap((one) => [one.label, one.value]),
      ...content.blocks.flatMap((block) => [block.heading, ...block.paragraphs]),
      ...REGIME_MENTIONS,
      content.footer,
      'Page 1/2',
    ];
    for (const word of words) expect(first, word).toContain(squeeze(word));
    const statement = content.annex;
    if (statement === null) throw new Error('no annex');
    for (const word of [
      ...statement.ref,
      statement.heading,
      statement.subheading,
      ...statement.accounts.rows.flatMap((row) => row.cells.map((cell) => cell.text)),
      ...statement.accounts.total.map((cell) => cell.text),
      ...statement.elements.rows.flatMap((row) => row.map((cell) => cell.text)),
      ...statement.elements.total.map((cell) => cell.text),
      statement.note,
      content.footer,
      'Page 2/2',
    ]) {
      expect(annex, word).toContain(squeeze(word));
    }
  });

  it('prints a row on the platform’s net, its empty cells and what its net is (CRM-03)', async () => {
    const source = sampleInvoice();
    const annex = source.annex;
    if (annex === null) throw new Error('no annex');
    const [first, second] = annex.accounts;
    if (first === undefined || second === undefined) throw new Error('two accounts');
    const content = invoicePdfContent({
      ...source,
      annex: {
        ...annex,
        accounts: [
          first,
          {
            ...second,
            base: 'platform_net',
            grossMinor: 41_250,
            grossEurMinor: 41_250,
            exclVatMinor: 41_250,
          },
        ],
      },
    });
    const [, page = ''] = (await pagesOf(await render(content))).map(squeeze);
    const row = content.annex?.accounts.rows[1];
    if (row?.detail == null) throw new Error('no row on the net');
    for (const word of [...row.cells.map((cell) => cell.text), row.detail]) {
      expect(page, word).toContain(squeeze(word));
    }
  });

  it('prints each label as whole words a machine finds, never letter by letter', async () => {
    const pages = await itemsOf(await render(invoicePdfContent(sampleInvoice())));
    const [first = [], annex = []] = pages;
    // « Autofacturation » is a mention the law asks for: found whole, as a word, by any reader.
    for (const label of [
      'AUTOFACTURATION',
      'PRESTATAIRE (FOURNISSEUR)',
      'CLIENT (PRENEUR)',
      'DÉSIGNATION',
      'MONTANT HT',
      'CONDITIONS DE PAIEMENT',
      'ACCEPTATION',
      'MENTIONS DU RÉGIME',
    ]) {
      expect(first, label).toContain(label);
    }
    // A header that fits stays on one line.
    for (const label of [
      'VENTES BRUTES',
      'COMMISSION PLATEFORME',
      'MONTANT FACTURÉ (FACTURE AEX-2026-0021)',
    ]) {
      expect(
        annex.map((item) => item.toLocaleUpperCase('fr')),
        label,
      ).toContain(label);
    }
  });

  it('renders the two French cases: the franchise and the VAT a company charges', async () => {
    for (const source of [frenchFranchise(), frenchCharged()]) {
      const content = invoicePdfContent(source);
      const pages = await pagesOf(await render(content));
      expect(pages).toHaveLength(2);
      const [first = ''] = pages.map(squeeze);
      for (const word of [
        content.parties[0].name,
        ...content.parties[0].ids.map((id) => `${id.label} : ${id.value}`),
        content.vatNote.lead,
        ...content.totals.flatMap((one) => [one.label, one.value]),
      ]) {
        expect(first, word).toContain(squeeze(word));
      }
    }
  });

  it('renders the credit note on one page, without a due date', async () => {
    const content = invoicePdfContent(sampleCreditNote());
    const pages = await pagesOf(await render(content));
    expect(pages).toHaveLength(1);
    const [page = ''] = pages.map(squeeze);
    for (const word of [
      content.heading,
      content.number,
      ...content.blocks.flatMap((block) => block.paragraphs),
      'Page 1/1',
    ]) {
      expect(page, word).toContain(squeeze(word));
    }
    // « Il n’a pas d’échéance » only: neither the label nor the day the copy keeps.
    expect(page).not.toContain(squeeze('Échéance :'));
    expect(page).not.toContain(squeeze('31 janvier 2027'));
  });

  it('renders the corrective invoice on one page, naming the invoice it replaces, with its due date', async () => {
    const content = invoicePdfContent(sampleCorrectiveInvoice());
    const pages = await pagesOf(await render(content));
    expect(pages).toHaveLength(1);
    const [page = ''] = pages.map(squeeze);
    for (const word of [
      content.heading,
      content.number,
      ...content.meta.flatMap((one) => [one.label, one.value]),
      ...content.object.map((one) => one.text),
      ...content.blocks.flatMap((block) => block.paragraphs),
      'Page 1/1',
    ]) {
      expect(page, word).toContain(squeeze(word));
    }
  });

  it('carries the worst case the limits allow over its pages, losing no word, each page with its foot', async () => {
    const content = invoicePdfContent(worstCase());
    const pages = await pagesOf(await render(content));
    expect(pages.length).toBeGreaterThanOrEqual(4);
    const all = squeeze(pages.join(' '));
    pages.forEach((page, index) => {
      expect(squeeze(page)).toContain(squeeze(`Page ${String(index + 1)}/${String(pages.length)}`));
      expect(squeeze(page)).toContain(squeeze(content.footer));
    });
    // Every page after the first names the document it continues.
    for (const page of pages.slice(1)) expect(squeeze(page)).toContain(squeeze(content.number));
    for (const word of [
      content.parties[0].name,
      ...content.parties[0].lines,
      ...content.lines.rows.flatMap((row) => [row.label, row.detail ?? '']),
      ...(content.mentions?.items ?? []),
      ...content.totals.map((one) => one.value),
    ]) {
      expect(all, word.slice(0, 40)).toContain(squeeze(word));
    }
  });

  it('draws the agency’s logo once for all its pages, and stays the same bytes with it', async () => {
    const content = invoicePdfContent(sampleInvoice());
    const logo = inventedLogo();
    const first = await render(content, logo);
    const second = await render(content, logo);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    expect(Buffer.from(first).equals(Buffer.from(await render(content)))).toBe(false);
    expect(ascii(first).match(/\/Subtype\s*\/Image/gu)?.length).toBe(2); // the image and its transparency
  });

  it('draws every kind of PNG Réglages › Facturation keeps: depths, palette, grey, interlaced', async () => {
    const content = invoicePdfContent(sampleInvoice());
    for (const [kind, bytes] of Object.entries(TRANSPARENT_KINDS)) {
      const pdf = await render(content, { mediaType: 'image/png', bytes });
      expect(ascii(pdf).match(/\/Subtype\s*\/Image/gu)?.length, kind).toBeGreaterThanOrEqual(1);
    }
  });

  it('refuses a logo that is not a PNG', async () => {
    const jpeg = {
      mediaType: 'image/png' as const,
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
    };
    await expect(render(invoicePdfContent(sampleInvoice()), jpeg)).rejects.toThrow(/PNG/u);
  });

  it('refuses a character the font has no glyph for, never printing a blank box', async () => {
    const source = sampleInvoice();
    const [first, ...rest] = source.lines;
    if (first === undefined) throw new Error('no line');
    const content = invoicePdfContent({
      ...source,
      lines: [{ ...first, label: 'Commission, compte 漢字' }, ...rest],
    });
    const failure = render(content);
    await expect(failure).rejects.toBeInstanceOf(InvoicePdfGlyphMissing);
    await expect(failure).rejects.toMatchObject({ codePoints: [0x6f22, 0x5b57] });
  });

  it('prints the specimen line on every page of a preview, never on a document', async () => {
    const specimen = 'Spécimen · données fictives · ne vaut pas facture';
    const preview = createPdfkitInvoiceRenderer(loadInvoiceFonts(FONTS_DIR), { specimen });
    const pages = await pagesOf(await preview.render(invoicePdfContent(sampleInvoice()), null, ISSUED_AT));
    for (const page of pages) expect(squeeze(page)).toContain(squeeze(specimen));
    const issued = await pagesOf(await render(invoicePdfContent(sampleInvoice())));
    for (const page of issued) expect(squeeze(page)).not.toContain(squeeze('Spécimen'));
  });
});
