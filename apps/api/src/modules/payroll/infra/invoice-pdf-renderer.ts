import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { create, type Font } from 'fontkit';
import PDFDocument from 'pdfkit';

import { InvoicePdfGlyphMissing } from '../domain/errors';
import type { InvoicePdfContent, PdfCell, PdfParty } from '../domain/invoice-pdf';
import type { InvoiceLogo, InvoicePdfRenderer } from '../domain/ports';

/**
 * The PDF of an invoice or a credit note (EQ-06 lot 4, ADR 0037 § 2), laid out by PDFKit as a PDF/A-3b: A4, Inter in
 * three weights embedded, black on white, navy for the title and the total, one gold rule under the head, as the
 * audit's mockup (01/11/2026) sets it. The same content, logo and instant always give the same bytes: no clock, no
 * random, the document's own instant as its dates. A character Inter has no glyph for throws, never prints a box.
 */

/** Inter 4.1 (SIL OFL 1.1, `fonts/OFL.txt`): Geist has no narrow no-break space, which French amounts need. */
export interface InvoiceFonts {
  readonly regular: Uint8Array;
  readonly medium: Uint8Array;
  readonly semibold: Uint8Array;
}

/** Reads the three weights from `dir`; a missing file throws at boot, never at the first invoice. */
export function loadInvoiceFonts(dir: string): InvoiceFonts {
  return {
    regular: readFileSync(join(dir, 'Inter-Regular.ttf')),
    medium: readFileSync(join(dir, 'Inter-Medium.ttf')),
    semibold: readFileSync(join(dir, 'Inter-SemiBold.ttf')),
  };
}

export interface InvoiceRendererOptions {
  /**
   * A line across the top of every page, for a preview built from invented data: « Spécimen · données fictives · ne
   * vaut pas facture ». Never set for an issued document.
   */
  readonly specimen?: string;
}

const MM = 72 / 25.4;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const SIDE = 18 * MM;
const TOP = 16 * MM;
const FOOT = 9 * MM;
const WIDTH = PAGE_WIDTH - 2 * SIDE;
/** The annex's first column (the account) never narrower than this while a header can break instead. */
const FIRST_COLUMN_MIN = 40 * MM;
const RIGHT = PAGE_WIDTH - SIDE;

const COLORS = {
  ink: '#111418',
  muted: '#5b6370',
  faint: '#8a919c',
  rule: '#d9dce1',
  hair: '#e9ebee',
  navy: '#0e1e3d',
  gold: '#a8793f',
  red: '#b42318',
} as const;

type Weight = 'regular' | 'medium' | 'semibold';

/** A text style, as the mockup's CSS sets it: size in points, line height as a multiple, tracking in em. */
interface Style {
  readonly weight: Weight;
  readonly size: number;
  readonly color: string;
  readonly lineHeight: number;
  readonly tracking?: number;
  readonly upper?: boolean;
  readonly figures?: boolean;
}

const BODY: Style = { weight: 'regular', size: 8.6, color: COLORS.ink, lineHeight: 1.45 };
/**
 * Capitals spaced a little, never as much as a tenth of an em: beyond it, a reader that extracts the text (pdf.js,
 * pdftotext, an accountant's OCR) reads each letter as a word (« D É S I G N A T I O N »).
 */
const LABEL: Style = {
  weight: 'semibold',
  size: 6.6,
  color: COLORS.muted,
  lineHeight: 1.45,
  tracking: 0.06,
  upper: true,
};
const AMOUNT: Style = { ...BODY, weight: 'medium', figures: true };

/** A run of a paragraph, for a lead word in bold or a value set apart from its label. */
interface Run {
  readonly text: string;
  readonly weight: Weight;
  readonly color: string;
}

const FONT_NAMES: Readonly<Record<Weight, string>> = {
  regular: 'Inter-Regular',
  medium: 'Inter-Medium',
  semibold: 'Inter-SemiBold',
};

function fontkitFont(bytes: Uint8Array): Font {
  const font = create(Buffer.from(bytes));
  if (!('hasGlyphForCodePoint' in font)) throw new Error('An invoice font is a collection, not one font');
  return font;
}

export function createPdfkitInvoiceRenderer(
  fonts: InvoiceFonts,
  options: InvoiceRendererOptions = {},
): InvoicePdfRenderer {
  const glyphs: Readonly<Record<Weight, Font>> = {
    regular: fontkitFont(fonts.regular),
    medium: fontkitFont(fonts.medium),
    semibold: fontkitFont(fonts.semibold),
  };
  const buffers: Readonly<Record<Weight, Buffer>> = {
    regular: Buffer.from(fonts.regular),
    medium: Buffer.from(fonts.medium),
    semibold: Buffer.from(fonts.semibold),
  };
  return {
    render: (content, logo, issuedAt) =>
      new Promise<Uint8Array>((resolve, reject) => {
        try {
          const doc = new PDFDocument({
            autoFirstPage: false,
            bufferPages: true,
            size: 'A4',
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            pdfVersion: '1.7',
            subset: 'PDF/A-3b',
            lang: 'fr-FR',
            displayTitle: true,
            // Only the number varies in the metadata: a name would need escaping in its XMP copy.
            info: {
              Title: content.title,
              Creator: 'Nirvana',
              Producer: 'Nirvana (PDFKit)',
              CreationDate: issuedAt,
              ModDate: issuedAt,
            },
          });
          const chunks: Buffer[] = [];
          doc.on('data', (chunk: Buffer) => chunks.push(chunk));
          doc.on('end', () => {
            resolve(new Uint8Array(Buffer.concat(chunks)));
          });
          doc.on('error', reject);
          for (const weight of ['regular', 'medium', 'semibold'] as const) {
            doc.registerFont(FONT_NAMES[weight], buffers[weight]);
          }
          new Layout(doc, glyphs, content, logo, options.specimen ?? null).draw();
          doc.end();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
  };
}

/** The document, laid out page by page from the top; the foot of every page is drawn once the pages are counted. */
class Layout {
  private y = TOP;
  private readonly logoSource: string | null;
  private readonly logoRatio: number;
  private readonly bottom: number;
  private readonly footer: { readonly top: number; readonly width: number; readonly height: number };

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly glyphs: Readonly<Record<Weight, Font>>,
    private readonly content: InvoicePdfContent,
    logo: InvoiceLogo | null,
    private readonly specimen: string | null,
  ) {
    // A data URI as the image's source: PDFKit keeps one image per source, so the annex reuses the head's.
    this.logoSource =
      logo === null ? null : `data:${logo.mediaType};base64,${Buffer.from(logo.bytes).toString('base64')}`;
    this.logoRatio = logo === null ? 1 : pngRatio(logo.bytes);
    const numberWidth = this.width(`${content.number} · Page 999/999`, this.footStyle);
    const width = WIDTH - numberWidth - 8 * MM;
    const height = this.height(content.footer, this.footStyle, width);
    const top = PAGE_HEIGHT - FOOT - height - 2 * MM;
    this.footer = { top, width, height };
    this.bottom = top - 5 * MM;
  }

  private readonly footStyle: Style = { ...BODY, size: 6.6, color: COLORS.faint };

  draw(): void {
    this.doc.addPage({ size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    this.head();
    this.goldRule();
    this.parties();
    this.object();
    this.lines();
    this.blocks();
    this.mentions();
    if (this.content.annex !== null) this.annex(this.content.annex);
    this.feet();
  }

  // Text: measured and drawn alike, with the CSS line height (half the leading above the first line).

  private checkGlyphs(text: string, weight: Weight): void {
    const missing = new Set<number>();
    for (const char of text) {
      const point = char.codePointAt(0);
      if (point !== undefined && char !== '\n' && !this.glyphs[weight].hasGlyphForCodePoint(point)) {
        missing.add(point);
      }
    }
    if (missing.size > 0) throw new InvoicePdfGlyphMissing([...missing]);
  }

  private shown(text: string, style: Style): string {
    return style.upper === true ? text.toLocaleUpperCase('fr-FR') : text;
  }

  private use(style: Style, weight: Weight = style.weight): PDFKit.Mixins.TextOptions {
    this.doc.font(FONT_NAMES[weight]).fontSize(style.size);
    const natural = this.doc.currentLineHeight(false);
    return {
      lineGap: style.size * style.lineHeight - natural,
      characterSpacing: (style.tracking ?? 0) * style.size,
      features: style.figures === true ? ['kern', 'tnum', 'cv11'] : ['kern', 'cv11'],
    };
  }

  private halfLeading(style: Style): number {
    this.doc.font(FONT_NAMES[style.weight]).fontSize(style.size);
    return (style.size * style.lineHeight - this.doc.currentLineHeight(false)) / 2;
  }

  private width(text: string, style: Style): number {
    const options = this.use(style);
    return this.doc.widthOfString(this.shown(text, style), options);
  }

  private height(text: string, style: Style, width: number): number {
    if (text === '') return 0;
    const options = this.use(style);
    const lines = this.lineCount(this.shown(text, style), { ...options, width });
    return lines * style.size * style.lineHeight;
  }

  /** How many lines `text` takes at `width`, as PDFKit breaks them. */
  private lineCount(text: string, options: PDFKit.Mixins.TextOptions): number {
    const step = this.doc.currentLineHeight(true) + (options.lineGap ?? 0);
    return Math.max(1, Math.round(this.doc.heightOfString(text, options) / step));
  }

  private text(
    text: string,
    x: number,
    y: number,
    width: number,
    style: Style,
    align: 'left' | 'right' | 'center' = 'left',
  ): number {
    if (text === '') return 0;
    const shown = this.shown(text, style);
    this.checkGlyphs(shown, style.weight);
    const lead = this.halfLeading(style);
    const options = this.use(style);
    this.doc.fillColor(style.color).text(shown, x, y + lead, { ...options, width, align });
    return this.height(text, style, width);
  }

  /**
   * One line that never breaks, right-aligned on `right`: a figure, a header, a date. A leading minus is the plain
   * hyphen-minus, which a spreadsheet reads (audit B7), set without the tabular width the figures take.
   */
  private line(text: string, right: number, y: number, style: Style): void {
    if (text === '') return;
    const minus = style.figures === true && text.startsWith('-');
    const rest = minus ? text.slice(1) : text;
    const plain: Style = { ...style, figures: false };
    const restWidth = this.width(rest, style);
    const minusWidth = minus ? this.width('-', plain) : 0;
    const lead = this.halfLeading(style);
    const draw = (part: string, x: number, partStyle: Style): void => {
      const shown = this.shown(part, partStyle);
      this.checkGlyphs(shown, partStyle.weight);
      const options = this.use(partStyle);
      this.doc.fillColor(partStyle.color).text(shown, x, y + lead, { ...options, lineBreak: false });
    };
    if (minus) draw('-', right - restWidth - minusWidth, plain);
    draw(rest, right - restWidth, style);
  }

  /** Runs in one paragraph, measured with the heaviest of their weights (never shorter than drawn). */
  private runsHeight(runs: readonly Run[], style: Style, width: number): number {
    const heaviest: Weight = runs.some((run) => run.weight === 'semibold')
      ? 'semibold'
      : runs.some((run) => run.weight === 'medium')
        ? 'medium'
        : 'regular';
    return this.height(runs.map((run) => run.text).join(''), { ...style, weight: heaviest }, width);
  }

  private runs(runs: readonly Run[], x: number, y: number, width: number, style: Style): number {
    const parts = runs.filter((run) => run.text !== '');
    const lead = this.halfLeading(style);
    parts.forEach((run, index) => {
      const shown = this.shown(run.text, style);
      this.checkGlyphs(shown, run.weight);
      const options = this.use(style, run.weight);
      this.doc.fillColor(run.color);
      const last = index === parts.length - 1;
      if (index === 0) {
        this.doc.text(shown, x, y + lead, { ...options, width, continued: !last });
      } else {
        this.doc.text(shown, { ...options, width, continued: !last });
      }
    });
    return this.runsHeight(runs, style, width);
  }

  private rule(y: number, color: string, thickness: number, x0 = SIDE, x1 = RIGHT): void {
    this.doc
      .save()
      .moveTo(x0, y + thickness / 2)
      .lineTo(x1, y + thickness / 2)
      .lineWidth(thickness)
      .strokeColor(color)
      .stroke()
      .restore();
  }

  // Pages.

  /** A new page when `height` does not fit; `continued` draws the small head of a page that follows. */
  private ensure(height: number, continued: () => void): boolean {
    if (this.y + height <= this.bottom) return false;
    this.doc.addPage({ size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    this.y = TOP;
    continued();
    return true;
  }

  private logoSize(height: number, maxWidth: number): { readonly width: number; readonly height: number } {
    const width = height * this.logoRatio;
    return width <= maxWidth ? { width, height } : { width: maxWidth, height: maxWidth / this.logoRatio };
  }

  /** The agency's mark: its logo at `height`, or its name in navy when it set none. Returns the height taken. */
  private brand(x: number, y: number, height: number, maxWidth: number): number {
    if (this.logoSource === null) {
      const style: Style = { weight: 'semibold', size: height / 1.6, color: COLORS.navy, lineHeight: 1.2 };
      return this.text(this.content.agencyName, x, y, maxWidth, style);
    }
    const size = this.logoSize(height, maxWidth);
    this.doc.image(this.logoSource, x, y, { width: size.width, height: size.height });
    return size.height;
  }

  /** The head of a page after the first: the mark, small, and what the page continues, line by line on the right. */
  private smallHead(lines: readonly (readonly Run[])[]): void {
    const style: Style = { ...BODY, size: 7.6, color: COLORS.muted };
    const lineHeight = style.size * style.lineHeight;
    const widths = lines.map((runs) =>
      runs.reduce((sum, run) => sum + this.width(run.text, { ...style, weight: run.weight }), 0),
    );
    const refHeight = lines.length * lineHeight;
    const markHeight = this.brand(SIDE, this.y, 9 * MM, WIDTH - Math.max(...widths) - 8 * MM);
    const height = Math.max(markHeight, refHeight);
    let y = this.y + (height - refHeight) / 2;
    lines.forEach((runs, index) => {
      const width = widths[index] ?? 0;
      this.runs(runs, RIGHT - width - 2, y, width + 2, style);
      y += lineHeight;
    });
    this.y += height + 7 * MM;
  }

  private continuedHead(): void {
    this.smallHead([[{ text: this.content.continued, weight: 'regular', color: COLORS.muted }]]);
  }

  // Page 1.

  private head(): void {
    const { content } = this;
    const title: Style = {
      weight: 'semibold',
      size: 20,
      color: COLORS.navy,
      lineHeight: 1,
      tracking: -0.01,
    };
    // « Autofacturation » is a mention the law asks for (art. 242 nonies A of annex II to the CGI): drawn without any
    // spacing, so that every reader finds the word whole.
    const badge: Style = { ...LABEL, color: COLORS.navy, tracking: 0 };
    const label: Style = { ...BODY, size: 8, color: COLORS.muted };
    const value = (strong: boolean): Style => ({ ...BODY, size: 8, weight: strong ? 'semibold' : 'medium' });
    const labelWidth = Math.max(...content.meta.map((row) => this.width(row.label, label)));
    const valueWidth = Math.max(...content.meta.map((row) => this.width(row.value, value(row.strong))));
    const metaWidth = labelWidth + 5 * MM + valueWidth;
    const badgeText = this.width(content.badge, badge);
    const badgeWidth = badgeText + 3.6 * MM;
    const rightWidth = Math.max(this.width(content.heading, title), badgeWidth, metaWidth);
    const top = this.y;

    // The title, its badge and the facts, right-aligned.
    let y = top;
    this.line(content.heading, RIGHT, y, title);
    y += title.size * title.lineHeight;
    y += 2 * MM;
    const badgeHeight = 0.7 * MM + badge.size * badge.lineHeight + 0.6 * MM;
    this.doc
      .save()
      .roundedRect(RIGHT - badgeWidth + 0.3, y + 0.3, badgeWidth - 0.6, badgeHeight - 0.6, 0.6 * MM)
      .lineWidth(0.6)
      .strokeColor(COLORS.navy)
      .stroke()
      .restore();
    this.line(content.badge, RIGHT - 1.8 * MM, y + 0.7 * MM, badge);
    y += badgeHeight + 3.4 * MM;
    for (const row of content.meta) {
      const rowTop = y + 0.55 * MM;
      this.text(row.label, RIGHT - metaWidth, rowTop, labelWidth + 4 * MM, label);
      this.line(row.value, RIGHT, rowTop, value(row.strong));
      y += 1.1 * MM + label.size * label.lineHeight;
    }
    const rightHeight = y - top;

    // The mark and who drafts the document, on the left.
    const leftWidth = WIDTH - rightWidth - 8 * MM;
    let left = top + this.brand(SIDE, top, 15 * MM, Math.min(leftWidth, 95 * MM));
    left += 2.4 * MM;
    const note: Style = { ...BODY, size: 6.8, color: COLORS.muted, lineHeight: 1.4 };
    left += this.text(content.brandNote, SIDE, left, Math.min(86 * MM, leftWidth), note);
    this.y = top + Math.max(rightHeight, left - top);
  }

  private goldRule(): void {
    this.y += 6 * MM;
    this.rule(this.y, COLORS.gold, 0.7);
    this.y += 0.7 + 5.5 * MM;
  }

  private partyHeight(party: PdfParty, width: number): number {
    const name: Style = { ...BODY, size: 9.4, weight: 'semibold' };
    const ids: Style = { ...BODY, size: 7.8, color: COLORS.muted };
    let height = this.height(party.name, name, width) + 0.8 * MM;
    for (const line of party.lines) height += this.height(line, BODY, width);
    if (party.ids.length > 0) height += 1.8 * MM;
    for (const id of party.ids) height += this.runsHeight(idRuns(id), ids, width);
    return height;
  }

  private party(party: PdfParty, x: number, y: number, width: number, boxHeight: number): void {
    const inner = width - 7.2 * MM;
    this.text(party.label, x, y, width, LABEL);
    const boxTop = y + LABEL.size * LABEL.lineHeight + 1.6 * MM;
    this.doc
      .save()
      .roundedRect(x + 0.3, boxTop + 0.3, width - 0.6, boxHeight - 0.6, 1 * MM)
      .lineWidth(0.6)
      .strokeColor(COLORS.rule)
      .stroke()
      .restore();
    let cursor = boxTop + 3.2 * MM;
    const name: Style = { ...BODY, size: 9.4, weight: 'semibold' };
    cursor += this.text(party.name, x + 3.6 * MM, cursor, inner, name) + 0.8 * MM;
    for (const line of party.lines) cursor += this.text(line, x + 3.6 * MM, cursor, inner, BODY);
    if (party.ids.length > 0) cursor += 1.8 * MM;
    const ids: Style = { ...BODY, size: 7.8, color: COLORS.muted };
    for (const id of party.ids) cursor += this.runs(idRuns(id), x + 3.6 * MM, cursor, inner, ids);
  }

  private parties(): void {
    const width = (WIDTH - 6 * MM) / 2;
    const inner = width - 7.2 * MM;
    const [seller, buyer] = this.content.parties;
    const boxHeight = Math.max(
      31 * MM,
      6.4 * MM + this.partyHeight(seller, inner),
      6.4 * MM + this.partyHeight(buyer, inner),
    );
    const height = LABEL.size * LABEL.lineHeight + 1.6 * MM + boxHeight;
    this.ensure(height, () => {
      this.continuedHead();
    });
    this.party(seller, SIDE, this.y, width, boxHeight);
    this.party(buyer, SIDE + width + 6 * MM, this.y, width, boxHeight);
    this.y += height;
  }

  private object(): void {
    const style: Style = { ...BODY, size: 8.2 };
    this.y += 5.5 * MM;
    this.content.object.forEach((paragraph, index) => {
      const runs: Run[] = [
        ...(paragraph.lead === null
          ? []
          : [{ text: paragraph.lead, weight: 'semibold' as const, color: COLORS.ink }]),
        { text: paragraph.text, weight: 'regular', color: COLORS.ink },
      ];
      const gap = index === 0 ? 0 : 0.8 * MM;
      this.ensure(gap + this.runsHeight(runs, style, WIDTH), () => {
        this.continuedHead();
      });
      this.y += gap;
      this.y += this.runs(runs, SIDE, this.y, WIDTH, style);
    });
  }

  // The lines and the totals.

  private lineRowHeight(row: InvoicePdfContent['lines']['rows'][number], labelWidth: number): number {
    const detail: Style = { ...BODY, size: 7.6, color: COLORS.muted };
    const label = this.height(row.label, { ...BODY, weight: 'medium' }, labelWidth);
    const below = row.detail === null ? 0 : 0.3 * MM + this.height(row.detail, detail, labelWidth);
    return 4.4 * MM + label + below + 0.5;
  }

  private linesHeader(amountWidth: number): void {
    const [label, amount] = this.content.lines.header;
    this.text(label, SIDE, this.y, WIDTH - amountWidth, LABEL);
    this.line(amount, RIGHT, this.y, LABEL);
    this.y += LABEL.size * LABEL.lineHeight + 1.6 * MM;
    this.rule(this.y, COLORS.ink, 0.8);
    this.y += 0.8;
  }

  private lines(): void {
    const { lines } = this.content;
    const amountWidth = Math.max(
      this.width(lines.header[1], LABEL),
      ...lines.rows.map((row) => this.width(row.amount, AMOUNT)),
    );
    const labelWidth = WIDTH - amountWidth - 6 * MM;
    const headerHeight = LABEL.size * LABEL.lineHeight + 1.6 * MM + 0.8;
    const totalsHeight = this.totalsHeight();
    const restart = (): void => {
      this.continuedHead();
      this.linesHeader(amountWidth);
    };
    this.y += 3.5 * MM;
    const first = lines.rows[0];
    const firstHeight = first === undefined ? 0 : this.lineRowHeight(first, labelWidth);
    const onlyRow = lines.rows.length === 1;
    this.ensure(headerHeight + firstHeight + (onlyRow ? totalsHeight : 0), () => {
      this.continuedHead();
    });
    this.linesHeader(amountWidth);
    lines.rows.forEach((row, index) => {
      const height = this.lineRowHeight(row, labelWidth);
      // The last line goes with the totals: they never stand alone at the top of a page.
      const keep = index === lines.rows.length - 1 ? totalsHeight : 0;
      this.ensure(height + keep, restart);
      const top = this.y + 2.2 * MM;
      let cursor = top + this.text(row.label, SIDE, top, labelWidth, { ...BODY, weight: 'medium' });
      if (row.detail !== null) {
        cursor += 0.3 * MM;
        this.text(row.detail, SIDE, cursor, labelWidth, { ...BODY, size: 7.6, color: COLORS.muted });
      }
      this.line(row.amount, RIGHT, top, AMOUNT);
      this.y += height - 0.5;
      this.rule(this.y, COLORS.hair, 0.5);
      this.y += 0.5;
    });
    this.totals();
  }

  private readonly sumWidth = 72 * MM;

  private vatNoteHeight(width: number): number {
    const style: Style = { ...BODY, size: 7.8 };
    const { vatNote } = this.content;
    return (
      1 * MM +
      2.4 * MM +
      this.runsHeight(vatRuns(vatNote), style, width) +
      this.height(vatNote.currency, style, width)
    );
  }

  private sumHeight(): number {
    return this.content.totals.reduce(
      (height, row) => height + (row.grand ? 0.8 + 3.4 * MM + 10.5 * 1.45 : 2.4 * MM + 8.4 * 1.45),
      0,
    );
  }

  private totalsHeight(): number {
    const noteWidth = WIDTH - this.sumWidth - 8 * MM - 3 * MM - 1.6;
    return 4 * MM + Math.max(this.vatNoteHeight(noteWidth), this.sumHeight());
  }

  private totals(): void {
    const { vatNote } = this.content;
    this.y += 4 * MM;
    const top = this.y;
    const noteWidth = WIDTH - this.sumWidth - 8 * MM - 3 * MM - 1.6;
    // The VAT note, a navy bar on its left.
    const style: Style = { ...BODY, size: 7.8 };
    const noteHeight = this.vatNoteHeight(noteWidth) - 1 * MM;
    this.doc
      .save()
      .moveTo(SIDE + 0.8, top + 1 * MM)
      .lineTo(SIDE + 0.8, top + 1 * MM + noteHeight)
      .lineWidth(1.6)
      .strokeColor(COLORS.navy)
      .stroke()
      .restore();
    let noteY = top + 1 * MM + 1.2 * MM;
    noteY += this.runs(vatRuns(vatNote), SIDE + 1.6 + 3 * MM, noteY, noteWidth, style);
    this.text(vatNote.currency, SIDE + 1.6 + 3 * MM, noteY, noteWidth, { ...style, color: COLORS.muted });

    // The sums, on the right.
    const x = RIGHT - this.sumWidth;
    let y = top;
    for (const row of this.content.totals) {
      if (row.grand) {
        this.rule(y, COLORS.ink, 0.8, x, RIGHT);
        const grand: Style = {
          ...BODY,
          size: 10.5,
          weight: 'semibold',
          color: COLORS.navy,
          figures: true,
        };
        const rowTop = y + 0.8 + 2.2 * MM;
        this.text(row.label, x, rowTop, this.sumWidth / 2, { ...grand, figures: false });
        this.line(row.value, RIGHT, rowTop, grand);
        y = rowTop + 10.5 * 1.45 + 1.2 * MM;
      } else {
        const plain: Style = { ...BODY, size: 8.4, figures: true };
        const rowTop = y + 1.2 * MM;
        this.text(row.label, x, rowTop, this.sumWidth / 2, { ...plain, figures: false });
        this.line(row.value, RIGHT, rowTop, { ...plain, color: row.muted ? COLORS.muted : COLORS.ink });
        y = rowTop + 8.4 * 1.45 + 1.2 * MM;
      }
    }
    this.y = top + Math.max(this.vatNoteHeight(noteWidth), y - top);
  }

  // The blocks and the regime's mentions.

  private blockHeight(block: InvoicePdfContent['blocks'][number], width: number): number {
    const paragraph: Style = { ...BODY, size: 7.6, lineHeight: 1.5 };
    return (
      LABEL.size * LABEL.lineHeight +
      1.6 * MM +
      block.paragraphs.reduce((sum, text) => sum + this.height(text, paragraph, width) + 1.2 * MM, 0)
    );
  }

  private blocks(): void {
    const width = (WIDTH - 6 * MM) / 2;
    const paragraph: Style = { ...BODY, size: 7.6, lineHeight: 1.5 };
    const height = Math.max(...this.content.blocks.map((block) => this.blockHeight(block, width)));
    this.y += 6.5 * MM;
    this.ensure(height, () => {
      this.continuedHead();
    });
    this.content.blocks.forEach((block, index) => {
      const x = SIDE + index * (width + 6 * MM);
      let y = this.y;
      y += this.text(block.heading, x, y, width, LABEL) + 1.6 * MM;
      for (const text of block.paragraphs) y += this.text(text, x, y, width, paragraph) + 1.2 * MM;
    });
    this.y += height;
  }

  private mentions(): void {
    const { mentions } = this.content;
    if (mentions === null) return;
    const item: Style = { ...BODY, size: 7.4, lineHeight: 1.5 };
    const itemWidth = WIDTH - 3 * MM;
    const itemHeight = (text: string): number => this.height(text, item, itemWidth) + 0.6 * MM;
    const headHeight = 0.5 + 3 * MM + LABEL.size * LABEL.lineHeight + 1.6 * MM;
    this.y += 5 * MM;
    // The heading never stands without its first mention.
    this.ensure(headHeight + itemHeight(mentions.items[0] ?? ''), () => {
      this.continuedHead();
    });
    this.rule(this.y, COLORS.rule, 0.5);
    this.y += 0.5 + 3 * MM;
    this.y += this.text(mentions.heading, SIDE, this.y, WIDTH, LABEL) + 1.6 * MM;
    for (const text of mentions.items) {
      this.ensure(itemHeight(text), () => {
        this.continuedHead();
      });
      this.rule(this.y + 2.1 * MM, COLORS.faint, 0.6, SIDE, SIDE + 1 * MM);
      this.text(text, SIDE + 3 * MM, this.y, itemWidth, item);
      this.y += itemHeight(text);
    }
  }

  // The annex: the validated statement.

  private annex(annex: NonNullable<InvoicePdfContent['annex']>): void {
    const ref: Run[][] = [
      [
        { text: `${annex.ref[0]} `, weight: 'regular', color: COLORS.muted },
        { text: annex.ref[1], weight: 'semibold', color: COLORS.muted },
      ],
      [{ text: annex.ref[2], weight: 'regular', color: COLORS.muted }],
    ];
    const head = (): void => {
      this.smallHead(ref);
    };
    this.doc.addPage({ size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    this.y = TOP;
    head();
    this.y += this.text(annex.heading, SIDE, this.y, WIDTH, {
      ...BODY,
      size: 12,
      weight: 'semibold',
      color: COLORS.navy,
    });
    this.y += 1 * MM;
    this.y += this.text(annex.subheading, SIDE, this.y, WIDTH, { ...BODY, color: COLORS.muted });
    this.table(annex.accounts.header, annex.accounts.rows, annex.accounts.total, head);
    this.table(
      annex.elements.header,
      annex.elements.rows.map((cells) => ({ cells, detail: null })),
      annex.elements.total,
      head,
    );
    const note: Style = { ...BODY, size: 7.6, color: COLORS.muted, lineHeight: 1.5 };
    this.y += 5 * MM;
    this.ensure(this.height(annex.note, note, WIDTH), head);
    this.y += this.text(annex.note, SIDE, this.y, WIDTH, note);
  }

  /**
   * A table of the annex: the first column takes what the figures leave, each figure column the width of its widest
   * cell or of its whole header. While the first column would be narrower than `FIRST_COLUMN_MIN`, the header that
   * saves the most breaks between its words, never inside a figure.
   */
  private table(
    header: readonly PdfCell[],
    rows: readonly { readonly cells: readonly PdfCell[]; readonly detail: string | null }[],
    total: readonly PdfCell[],
    head: () => void,
  ): void {
    const strong: Style = { ...BODY, weight: 'semibold', figures: true };
    const figure: Style = { ...BODY, figures: true };
    const detail: Style = { ...BODY, size: 7.6, color: COLORS.muted };
    const bounds = header.map((cell, index) => {
      if (index === 0) return { whole: 0, broken: 0 };
      const cells = [...rows.map((row) => row.cells[index]?.text ?? ''), total[index]?.text ?? ''];
      const figures = Math.max(...cells.map((text) => this.width(text, strong)));
      const words = cell.text.split(/\s+/u).map((word) => this.width(word, LABEL));
      return {
        whole: Math.max(figures, this.width(cell.text, LABEL)) + 1,
        broken: Math.max(figures, ...words) + 1,
      };
    });
    const columns = bounds.map((bound) => bound.whole);
    const firstOf = (): number =>
      WIDTH - columns.reduce((sum, width, index) => sum + (index === 0 ? 0 : width + 6 * MM), 0);
    for (;;) {
      if (firstOf() >= FIRST_COLUMN_MIN) break;
      let widest = -1;
      columns.forEach((width, index) => {
        const saving = width - (bounds[index]?.broken ?? width);
        const best = widest === -1 ? 0 : (columns[widest] ?? 0) - (bounds[widest]?.broken ?? 0);
        if (saving > 0 && saving > best) widest = index;
      });
      if (widest === -1) break;
      columns[widest] = bounds[widest]?.broken ?? 0;
    }
    const firstWidth = firstOf();
    const widths = columns.map((width, index) => (index === 0 ? firstWidth : width));
    const xOf = (index: number): number =>
      SIDE +
      widths.slice(0, index).reduce((sum, width, i) => sum + width + (i === 0 ? 0 : 6 * MM), 0) +
      (index === 0 ? 0 : 6 * MM);
    const headerHeight =
      Math.max(...header.map((cell, index) => this.height(cell.text, LABEL, widths[index] ?? 0))) +
      1.6 * MM +
      0.8;
    const drawHeader = (): void => {
      const height = headerHeight - 1.6 * MM - 0.8;
      header.forEach((cell, index) => {
        const cellHeight = this.height(cell.text, LABEL, widths[index] ?? 0);
        this.text(cell.text, xOf(index), this.y + height - cellHeight, widths[index] ?? 0, LABEL, cell.align);
      });
      this.y += headerHeight - 0.8;
      this.rule(this.y, COLORS.ink, 0.8);
      this.y += 0.8;
    };
    const cellsHeight = (cells: readonly PdfCell[], style: Style): number =>
      Math.max(...cells.map((cell, index) => this.height(cell.text, style, widths[index] ?? 0)));
    // A row's detail (a conversion) runs under the whole row: in the first column alone, it would break word by word.
    const rowHeight = (cells: readonly PdfCell[], below: string | null, style: Style): number =>
      4 * MM + cellsHeight(cells, style) + (below === null ? 0 : this.height(below, detail, WIDTH));
    const drawRow = (cells: readonly PdfCell[], below: string | null, style: Style): number => {
      const top = this.y + 2 * MM;
      cells.forEach((cell, index) => {
        const width = widths[index] ?? 0;
        if (cell.align === 'right') this.line(cell.text, xOf(index) + width, top, style);
        else this.text(cell.text, xOf(index), top, width, { ...style, figures: false });
      });
      if (below !== null) this.text(below, SIDE, top + cellsHeight(cells, style), WIDTH, detail);
      return rowHeight(cells, below, style);
    };
    this.y += 5 * MM;
    const totalHeight = rowHeight(total, null, strong) + 0.8;
    const restart = (): void => {
      head();
      drawHeader();
    };
    const firstRow = rows[0];
    this.ensure(
      headerHeight + (firstRow === undefined ? 0 : rowHeight(firstRow.cells, firstRow.detail, figure)),
      head,
    );
    drawHeader();
    rows.forEach((row, index) => {
      const height = rowHeight(row.cells, row.detail, figure) + 0.5;
      // The last row goes with the total.
      this.ensure(height + (index === rows.length - 1 ? totalHeight : 0), restart);
      this.y += drawRow(row.cells, row.detail, figure);
      this.rule(this.y, COLORS.hair, 0.5);
      this.y += 0.5;
    });
    this.ensure(totalHeight, restart);
    this.rule(this.y, COLORS.ink, 0.8);
    this.y += 0.8;
    this.y += drawRow(total, null, strong);
  }

  // The foot of every page, and the specimen line of a preview.

  private feet(): void {
    const range = this.doc.bufferedPageRange();
    const numberStyle: Style = { ...this.footStyle, color: COLORS.muted };
    for (let index = 0; index < range.count; index += 1) {
      this.doc.switchToPage(range.start + index);
      const { top, width, height } = this.footer;
      this.rule(top, COLORS.hair, 0.5);
      this.text(this.content.footer, SIDE, top + 0.5 + 2 * MM, width, this.footStyle);
      const number = `${this.content.number} · Page ${String(index + 1)}/${String(range.count)}`;
      const lineHeight = this.footStyle.size * this.footStyle.lineHeight;
      this.line(number, RIGHT, top + 0.5 + 2 * MM + height - lineHeight, numberStyle);
      if (this.specimen !== null) {
        const style: Style = {
          weight: 'semibold',
          size: 6.5,
          color: COLORS.red,
          lineHeight: 1.45,
          tracking: 0.06,
          upper: true,
        };
        this.text(this.specimen, SIDE, 6 * MM, WIDTH, style, 'center');
      }
    }
  }
}

function idRuns(id: { readonly label: string; readonly value: string }): Run[] {
  return [
    { text: `${id.label}\u00a0: `, weight: 'regular', color: COLORS.muted },
    { text: id.value, weight: 'medium', color: COLORS.ink },
  ];
}

function vatRuns(note: InvoicePdfContent['vatNote']): Run[] {
  return [
    { text: note.lead, weight: 'semibold', color: COLORS.ink },
    { text: ` · ${note.text}`, weight: 'regular', color: COLORS.ink },
  ];
}

/** A PNG's width over its height, read from its header (IHDR); a file that is not a PNG throws. */
function pngRatio(bytes: Uint8Array): number {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) {
    throw new Error('The agency logo is not a PNG');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) throw new Error('The agency logo has no size');
  return width / height;
}
