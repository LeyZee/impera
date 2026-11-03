import {
  calendarDayAt,
  payPeriodLastDay,
  payPeriodOfDay,
  type PlatformChatter,
  type PlatformChatterDailyStat,
  type PlatformDailyStat,
  type PlatformModel,
  type SaleEvent,
  type SalesFeedCheckChatter,
  type SalesFeedCheckDay,
  type SalesFeedCheckNote,
  type SalesFeedCheckReport,
  type SalesFeedCheckTotals,
  type SalesFeedCheckVerdict,
  type SalesFeedErrorKind,
} from '@nirvana/contracts';

import { SalesFeedExportUnprocessable } from './errors';
import type { ChatterLink } from './sales-feed';

/**
 * The reliability check of ADR 0050 § 8 (CRM-02): before any account switches to the platform's net, the register is
 * compared, to the cent, with the platform's daily statistics and with the dashboard's export, per model and day,
 * then per team member. Pure: the application gathers the three sources and this file says where they differ.
 */

/** A line of the register (recorded or in quarantine), with no fan data. */
export interface CheckLine {
  readonly platformSaleId: string;
  readonly event: SaleEvent;
  readonly occurredAt: Date;
  readonly platformModelId: string;
  readonly platformChatterId: string | null;
  readonly grossInclVat: number;
  readonly net: number;
  readonly agency: number;
  readonly creator: number;
  /** Recorded for a linked model; `false` in quarantine. */
  readonly linked: boolean;
}

/** The export, read: amounts per model id (resolved from an id or a handle) and day. */
export interface ReadExport {
  readonly rows: readonly ExportRow[];
  readonly notes: readonly SalesFeedCheckNote[];
}

interface ExportRow {
  readonly date: string;
  readonly platformModelId: string;
  readonly totals: SalesFeedCheckTotals;
}

// ---------------------------------------------------------------------------------------------------------------------
// The dashboard's export

/**
 * The headers the export may carry, by what they hold, compared once lower-cased and stripped of accents, spaces and
 * punctuation. The real export has not been seen yet (Charles gives it with CRM-02): these are the names Reveal's API
 * and dashboard use, to be completed here when it comes. A column named for the fan is never read.
 */
const EXPORT_HEADERS = {
  date: ['date', 'jour', 'day'],
  model: ['modelid', 'model', 'modele', 'modelusername', 'creatrice', 'createur', 'creator'],
  grossInclVat: [
    'revenuettc',
    'revenuttc',
    'cattc',
    'chiffredaffairesttc',
    'montantttc',
    'amountttc',
    'brutttc',
    'ttc',
  ],
  agency: ['agencyrevenue', 'revenuagence', 'revenuedelagence', 'revenuagency', 'partagence', 'agence'],
  creator: ['modelrevenue', 'revenumodele', 'revenucreatrice', 'partmodele', 'partcreatrice'],
  net: ['netamount', 'netrevenue', 'revenunet', 'montantnet', 'net'],
} as const;

type ExportColumn = keyof typeof EXPORT_HEADERS;

const EXPORT_COLUMN_NAMES: Record<ExportColumn, string> = {
  date: 'date',
  model: 'modèle',
  grossInclVat: 'montant TTC',
  agency: 'revenu agence',
  creator: 'revenu modèle',
  net: 'net',
};

function headerKey(header: string): string {
  return header
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** The separator the header line uses most: `;` (a French spreadsheet), `,` or a tab. */
function separatorOf(headerLine: string): string {
  const counts = [';', ',', '\t'].map((separator) => ({
    separator,
    count: headerLine.split(separator).length,
  }));
  return counts.reduce((best, one) => (one.count > best.count ? one : best)).separator;
}

/** RFC 4180 lines: quoted cells may hold the separator, a doubled quote or a line break. */
function csvRows(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"' && text.charAt(index + 1) === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text.charAt(index + 1) === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((one) => one.some((value) => value.trim() !== ''));
}

/**
 * An amount in euros as a spreadsheet writes it (`12,34 €`, `1 234,56`, `1,234.56`, `-3`) in cents; `null` when it is
 * not one. The last `,` or `.` followed by one or two digits is the decimal mark.
 */
export function exportAmountToCents(raw: string): number | null {
  const compact = raw.replace(/[\s\u00a0\u202f€]|EUR/g, '');
  if (compact === '') return null;
  const decimal = /[.,](\d{1,2})$/.exec(compact);
  const whole = decimal === null ? compact : compact.slice(0, decimal.index);
  const units = whole.replace(/[.,]/g, '');
  if (!/^-?\d+$/.test(units)) return null;
  const negative = units.startsWith('-');
  const cents = Number(units.replace('-', '')) * 100 + Number((decimal?.[1] ?? '0').padEnd(2, '0'));
  return negative ? -cents : cents;
}

/** `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY` or an ISO instant (its day in `timeZone`); `null` otherwise. */
export function exportDay(raw: string, timeZone: string): string | null {
  const value = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const french = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(value);
  const [, dd = '', mm = '', yyyy = ''] = french ?? [];
  const day = iso === null ? (french === null ? null : `${yyyy}-${mm}-${dd}`) : value;
  if (day !== null) return Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? null : day;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : calendarDayAt(at, timeZone);
}

/**
 * Reads the dashboard's export (CSV, one row per sale or per day) into amounts per model and day of `from`–`to`. A row
 * per sale and a row per day both sum. The model is a model id or a handle of `models`. Throws
 * `SalesFeedExportUnprocessable` when a column it needs is missing or a cell of a row is unreadable: then nothing is
 * compared, rather than a half-read export.
 */
export function readDashboardExport(
  text: string,
  context: {
    readonly from: string;
    readonly to: string;
    readonly timeZone: string;
    readonly models: readonly PlatformModel[];
  },
): ReadExport {
  const body = text.replace(/^\uFEFF/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  const [header, ...lines] = csvRows(body, separatorOf(firstLine));
  if (header === undefined) throw new SalesFeedExportUnprocessable('le fichier est vide', {});
  const keys = header.map(headerKey);
  const indexOf = (column: ExportColumn): number | null => {
    const names: readonly string[] = EXPORT_HEADERS[column];
    const index = keys.findIndex((key) => names.includes(key));
    return index === -1 ? null : index;
  };
  const columns = {
    date: indexOf('date'),
    model: indexOf('model'),
    grossInclVat: indexOf('grossInclVat'),
    agency: indexOf('agency'),
    creator: indexOf('creator'),
    net: indexOf('net'),
  };
  for (const column of ['date', 'model'] as const) {
    if (columns[column] === null) {
      throw new SalesFeedExportUnprocessable(`colonne « ${EXPORT_COLUMN_NAMES[column]} » introuvable`, {
        column: EXPORT_COLUMN_NAMES[column],
      });
    }
  }
  if (columns.net === null && (columns.agency === null || columns.creator === null)) {
    throw new SalesFeedExportUnprocessable(
      'il faut la colonne « net », ou « revenu agence » et « revenu modèle »',
      {
        column: EXPORT_COLUMN_NAMES.net,
      },
    );
  }

  const byHandle = new Map(
    context.models.map((model) => [model.handle.toLowerCase(), model.platformModelId]),
  );
  const ids = new Set(context.models.map((model) => model.platformModelId));
  const sums = new Map<string, ExportRow>();
  const unknownModels = new Set<string>();
  let outside = 0;

  lines.forEach((cells, index) => {
    const line = index + 2;
    const cell = (column: number | null): string | null =>
      column === null ? null : (cells[column] ?? '').trim();
    const date = exportDay(cell(columns.date) ?? '', context.timeZone);
    if (date === null) {
      throw new SalesFeedExportUnprocessable(`la ligne ${String(line)} n’a pas de date lisible`, {
        column: EXPORT_COLUMN_NAMES.date,
        line,
      });
    }
    const amount = (column: Exclude<ExportColumn, 'date' | 'model'>): number | null => {
      const raw = cell(columns[column]);
      if (raw === null) return null;
      const cents = exportAmountToCents(raw);
      if (cents === null) {
        throw new SalesFeedExportUnprocessable(
          `la ligne ${String(line)} n’a pas de montant lisible en « ${EXPORT_COLUMN_NAMES[column]} »`,
          { column: EXPORT_COLUMN_NAMES[column], line },
        );
      }
      return cents;
    };
    const agency = amount('agency');
    const creator = amount('creator');
    const net = amount('net') ?? (agency !== null && creator !== null ? agency + creator : null);
    const totals: SalesFeedCheckTotals = { grossInclVat: amount('grossInclVat'), agency, creator, net };
    if (date < context.from || date > context.to) {
      outside += 1;
      return;
    }
    const model = cell(columns.model) ?? '';
    const platformModelId = ids.has(model) ? model : byHandle.get(model.toLowerCase());
    if (platformModelId === undefined) {
      if (model !== '') unknownModels.add(model.slice(0, 100));
      return;
    }
    const key = `${date}|${platformModelId}`;
    const previous = sums.get(key);
    sums.set(key, {
      date,
      platformModelId,
      totals: previous === undefined ? totals : addTotals(previous.totals, totals),
    });
  });

  const notes: SalesFeedCheckNote[] = [...unknownModels].map((model) => ({
    kind: 'export_unknown_model',
    model,
  }));
  if (outside > 0) notes.push({ kind: 'export_rows_outside', count: outside });
  return { rows: [...sums.values()], notes };
}

// ---------------------------------------------------------------------------------------------------------------------
// The comparison

const ZERO: SalesFeedCheckTotals = { grossInclVat: 0, agency: 0, creator: 0, net: 0 };

function addTotals(a: SalesFeedCheckTotals, b: SalesFeedCheckTotals): SalesFeedCheckTotals {
  const add = (x: number | null, y: number | null): number | null =>
    x === null || y === null ? null : x + y;
  return {
    grossInclVat: add(a.grossInclVat, b.grossInclVat),
    agency: add(a.agency, b.agency),
    creator: add(a.creator, b.creator),
    net: add(a.net, b.net),
  };
}

/** Two sources agree when every figure both give is the same, to the cent. */
function agrees(a: SalesFeedCheckTotals, b: SalesFeedCheckTotals): boolean {
  return (['grossInclVat', 'agency', 'creator', 'net'] as const).every(
    (field) => a[field] === null || b[field] === null || a[field] === b[field],
  );
}

function isZero(totals: SalesFeedCheckTotals): boolean {
  return Object.values(totals).every((value) => value === null || value === 0);
}

function signed(line: CheckLine): SalesFeedCheckTotals {
  const sign = line.event === 'refund' ? -1 : 1;
  return {
    grossInclVat: sign * line.grossInclVat,
    agency: sign * line.agency,
    creator: sign * line.creator,
    net: sign * line.net,
  };
}

export interface CheckSources {
  readonly platform: SalesFeedCheckReport['platform'];
  readonly from: string;
  readonly to: string;
  /** The zone the platform counts its days in (Reveal: `Europe/Paris`). */
  readonly timeZone: string;
  readonly generatedAt: Date;
  /** The register's sales of the days, and every refund read since their first day. */
  readonly lines: readonly CheckLine[];
  readonly stats:
    | {
        readonly ok: true;
        readonly daily: readonly PlatformDailyStat[];
        readonly chatters: readonly PlatformChatterDailyStat[];
      }
    | { readonly ok: false; readonly errorKind: SalesFeedErrorKind };
  readonly exported: ReadExport | null;
  /** The register's oldest line, whatever its model; `null` when it has none. */
  readonly firstLineAt: Date | null;
  /** When the register was last read from the platform (its cursor), `null` never. */
  readonly registerReadAt: Date | null;
  readonly models: readonly PlatformModel[];
  readonly modelLinks: ReadonlySet<string>;
  readonly platformChatters: readonly PlatformChatter[];
  readonly chatterLinks: ReadonlyMap<string, ChatterLink>;
}

/**
 * Builds the report. The register counts a sale on its day in the platform's zone and takes a refund off its sale's
 * day, as the statistics do ("un remboursement retire la vente de son jour"); a refund whose sale the register does
 * not have is only counted in a note. A day of a model nobody reports a cent for is left out.
 */
export function buildCheckReport(sources: CheckSources): SalesFeedCheckReport {
  const { from, to, timeZone } = sources;
  const inDays = (date: string): boolean => date >= from && date <= to;
  const dayOf = (at: Date): string => calendarDayAt(at, timeZone);

  const sales = new Map<string, CheckLine>();
  for (const line of sources.lines) if (line.event === 'sale') sales.set(line.platformSaleId, line);

  const register = new Map<string, SalesFeedCheckTotals>();
  const linkedSeen = new Map<string, boolean>();
  const chatterRegister = new Map<string | null, { net: number; sales: number }>();
  let refundsWithoutSale = 0;
  for (const line of sources.lines) {
    const sale = line.event === 'sale' ? line : sales.get(line.platformSaleId);
    if (sale === undefined) {
      if (inDays(dayOf(line.occurredAt))) refundsWithoutSale += 1;
      continue;
    }
    const date = dayOf(sale.occurredAt);
    if (!inDays(date)) continue;
    const key = `${date}|${line.platformModelId}`;
    register.set(key, addTotals(register.get(key) ?? ZERO, signed(line)));
    linkedSeen.set(line.platformModelId, line.linked || (linkedSeen.get(line.platformModelId) ?? false));
    const chatter = chatterRegister.get(sale.platformChatterId) ?? { net: 0, sales: 0 };
    const refund = line.event === 'refund';
    chatterRegister.set(sale.platformChatterId, {
      net: chatter.net + (refund ? -line.net : line.net),
      sales: chatter.sales + (refund ? -1 : 1),
    });
  }

  const stats = new Map<string, SalesFeedCheckTotals>();
  if (sources.stats.ok) {
    for (const row of sources.stats.daily) {
      if (!inDays(row.date)) continue;
      stats.set(`${row.date}|${row.platformModelId}`, {
        grossInclVat: row.revenueInclVat,
        agency: row.agency,
        creator: row.creator,
        net: row.agency + row.creator,
      });
    }
  }
  const exported = new Map(
    sources.exported?.rows.map((row) => [`${row.date}|${row.platformModelId}`, row.totals]),
  );

  const handles = new Map(sources.models.map((model) => [model.platformModelId, model.handle]));
  const keys = [...new Set([...register.keys(), ...stats.keys(), ...exported.keys()])].sort();
  const days: SalesFeedCheckDay[] = [];
  for (const key of keys) {
    const [date = '', platformModelId = ''] = key.split('|');
    const registered = register.get(key) ?? ZERO;
    const stat = sources.stats.ok ? (stats.get(key) ?? ZERO) : null;
    const exportedDay = sources.exported === null ? null : (exported.get(key) ?? ZERO);
    if ([registered, stat, exportedDay].every((one) => one === null || isZero(one))) continue;
    const differs: SalesFeedCheckDay['differs'] = [];
    if (stat !== null && !agrees(registered, stat)) differs.push('stats');
    if (exportedDay !== null && !agrees(registered, exportedDay)) differs.push('export');
    days.push({
      date,
      platformModelId,
      handle: handles.get(platformModelId) ?? null,
      linked: linkedSeen.get(platformModelId) ?? sources.modelLinks.has(platformModelId),
      register: registered,
      stats: stat,
      export: exportedDay,
      differs,
    });
  }

  const sum = (pick: (day: SalesFeedCheckDay) => SalesFeedCheckTotals | null): SalesFeedCheckTotals =>
    days.reduce<SalesFeedCheckTotals>((total, day) => addTotals(total, pick(day) ?? ZERO), ZERO);
  const exportColumns = sources.exported?.rows[0]?.totals;
  const exportTotal = (): SalesFeedCheckTotals => {
    const total = sum((day) => day.export);
    // A column the export lacks stays `null` in its total too.
    return {
      grossInclVat: exportColumns?.grossInclVat === null ? null : total.grossInclVat,
      agency: exportColumns?.agency === null ? null : total.agency,
      creator: exportColumns?.creator === null ? null : total.creator,
      net: exportColumns?.net === null ? null : total.net,
    };
  };

  const chatters = chatterRows(sources, chatterRegister, inDays);
  const notes: SalesFeedCheckNote[] = [...(sources.exported?.notes ?? [])];
  if (refundsWithoutSale > 0) notes.push({ kind: 'refund_without_sale', count: refundsWithoutSale });
  if (!sources.stats.ok) notes.push({ kind: 'stats_unavailable', errorKind: sources.stats.errorKind });
  if (sources.firstLineAt === null || dayOf(sources.firstLineAt) > from) {
    notes.push({ kind: 'register_starts_after', firstLineAt: sources.firstLineAt?.toISOString() ?? null });
  }
  for (const chatter of sources.platformChatters) {
    if (chatter.isBot && sources.chatterLinks.get(chatter.platformChatterId)?.kind !== 'agent') {
      notes.push({ kind: 'bot_not_linked_to_agent', platformChatterId: chatter.platformChatterId });
    }
  }

  const anyDifference =
    days.some((day) => day.differs.length > 0) || chatters.some((chatter) => chatter.differs);
  // Something left uncompared (a source missing, a model of the export unknown, days before the register) is never
  // a match: the switch of CRM-03 needs one.
  const uncompared = notes.some((note) =>
    ['stats_unavailable', 'export_unknown_model', 'register_starts_after'].includes(note.kind),
  );
  const verdict: SalesFeedCheckVerdict = anyDifference
    ? 'mismatch'
    : sources.stats.ok && sources.exported !== null && !uncompared
      ? 'match'
      : 'incomplete';

  return {
    platform: sources.platform,
    from,
    to,
    timeZone,
    generatedAt: sources.generatedAt.toISOString(),
    registerReadAt: sources.registerReadAt?.toISOString() ?? null,
    verdict,
    total: {
      register: sum((day) => day.register),
      stats: sources.stats.ok ? sum((day) => day.stats) : null,
      export: sources.exported === null ? null : exportTotal(),
    },
    days,
    chatters,
    notes,
  };
}

function chatterRows(
  sources: CheckSources,
  registered: ReadonlyMap<string | null, { net: number; sales: number }>,
  inDays: (date: string) => boolean,
): SalesFeedCheckChatter[] {
  const stats = new Map<string | null, { net: number; sales: number }>();
  if (sources.stats.ok) {
    for (const row of sources.stats.chatters) {
      if (!inDays(row.date)) continue;
      const previous = stats.get(row.platformChatterId) ?? { net: 0, sales: 0 };
      stats.set(row.platformChatterId, {
        net: previous.net + row.agency + row.creator,
        sales: previous.sales + row.salesCount,
      });
    }
  }
  const bots = new Map(sources.platformChatters.map((chatter) => [chatter.platformChatterId, chatter.isBot]));
  const ids = [...new Set([...registered.keys(), ...stats.keys()])].sort((a, b) =>
    a === null ? 1 : b === null ? -1 : a.localeCompare(b),
  );
  const rows: SalesFeedCheckChatter[] = [];
  for (const id of ids) {
    const register = registered.get(id) ?? { net: 0, sales: 0 };
    const stat = sources.stats.ok ? (stats.get(id) ?? { net: 0, sales: 0 }) : null;
    if (
      register.net === 0 &&
      register.sales === 0 &&
      (stat === null || (stat.net === 0 && stat.sales === 0))
    ) {
      continue;
    }
    rows.push({
      platformChatterId: id,
      isBot: id === null ? null : (bots.get(id) ?? null),
      link: id === null ? null : (sources.chatterLinks.get(id)?.kind ?? null),
      register,
      stats: stat,
      differs: stat !== null && stat.net !== register.net,
    });
  }
  return rows;
}

/**
 * The report a switch to the platform's net can rest on (CRM-03, ADR 0050 § 8): a match over one whole fortnight (the
 * 1st to the 15th, or the 16th to the month's end), with no bot of the platform outside the agent (its sales would
 * count for nobody, or for a member) nor model of the export unknown (its rows left out). A day that agrees, checked
 * after a fortnight that did not, is never clean.
 */
export function isCleanMatch(report: SalesFeedCheckReport): boolean {
  const period = payPeriodOfDay(report.from);
  return (
    report.verdict === 'match' &&
    report.from === period &&
    report.to === payPeriodLastDay(period) &&
    !report.notes.some(
      (note) => note.kind === 'bot_not_linked_to_agent' || note.kind === 'export_unknown_model',
    )
  );
}
