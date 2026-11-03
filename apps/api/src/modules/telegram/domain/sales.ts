import {
  DEFAULT_TELEGRAM_SALE_SETTINGS,
  type CreatorId,
  type Currency,
  PLATFORM_NAMES,
  type SalesTotals,
  type TelegramSaleSettings,
  type TelegramSaleSettingsEntry,
} from '@impera/contracts';

import type { MemberNameOf } from './classify';
import type { SalesDay } from './ports';
import { renderPlain } from './render';
import type { Signal } from './signals';

/**
 * The sales topic (CRM-04 lot b): which fresh sale rings under the owner's settings, and what the evening digest says.
 * Pure. The figures are the register's sums (`salesTotals` of `connectors`), never summed again here except to put the
 * rows of one seller or one currency together; no VAT nor commission is computed (ADR 0050 § 8).
 */

/** Her own settings, else the ones for every creator, else the defaults (every sale rings, the digest goes). */
export function saleSettingsFor(
  entries: readonly TelegramSaleSettingsEntry[],
  creatorId: CreatorId | null,
): TelegramSaleSettings {
  const hers = creatorId === null ? undefined : entries.find((entry) => entry.creatorId === creatorId);
  const forAll = entries.find((entry) => entry.creatorId === null);
  const chosen = hers ?? forAll;
  return chosen === undefined
    ? DEFAULT_TELEGRAM_SALE_SETTINGS
    : { minimumMinor: chosen.minimumMinor, agentOnly: chosen.agentOnly, eveningDigest: chosen.eveningDigest };
}

const RATE_SCALE = BigInt(1_000_000);

/**
 * A dollar price in euro cents (`rateMicros` euros per million dollars), as pay and the Dashboard convert: `usdMinor ×
 * rateMicros ÷ 1 000 000`, a half cent rounded away from zero, on integers.
 */
function usdToEurMinor(usdMinor: number, rateMicros: number): bigint {
  const product = BigInt(usdMinor) * BigInt(rateMicros);
  const quotient = product / RATE_SCALE;
  return BigInt(2) * (product % RATE_SCALE) >= RATE_SCALE ? quotient + BigInt(1) : quotient;
}

/**
 * A fresh sale rings at or above the minimum price (VAT included, in euros), and only the agent's when the owner said
 * so. A dollar sale is weighed at the rate of its day (`usdRateMicros`); with no rate, it rings: the minimum filters
 * noise, it never hides a sale it cannot weigh. The message keeps the sale's own currency.
 */
export function saleRings(
  settings: TelegramSaleSettings,
  signal: Signal & { kind: 'sale' },
  usdRateMicros: number | null,
): boolean {
  if (settings.agentOnly && signal.seller.kind !== 'agent') return false;
  if (settings.minimumMinor === 0) return true;
  if (signal.currency === 'EUR') return signal.grossInclVatMinor >= settings.minimumMinor;
  if (usdRateMicros === null) return true;
  return usdToEurMinor(signal.grossInclVatMinor, usdRateMicros) >= BigInt(settings.minimumMinor);
}

const AMOUNT: Readonly<Record<Currency, Intl.NumberFormat>> = {
  EUR: new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }),
  USD: new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' }),
};

/** « 1 234,56 € », cents always shown; a total with refunds taken off can be negative. */
export const saleAmount = (minor: number, currency: Currency): string => AMOUNT[currency].format(minor / 100);

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count > 1 ? many : one}`;

interface Sums {
  sales: number;
  refunds: number;
  gross: number;
  net: number;
  agency: number;
  creator: number;
}

const zero = (): Sums => ({ sales: 0, refunds: 0, gross: 0, net: 0, agency: 0, creator: 0 });

function add(sums: Sums, row: SalesTotals['rows'][number]): void {
  sums.sales += row.sales;
  sums.refunds += row.refunds;
  sums.gross += row.grossInclVatMinor;
  sums.net += row.netMinor;
  sums.agency += row.agencyMinor;
  sums.creator += row.creatorMinor;
}

type SellerKey = `member:${string}` | 'agent' | 'unlinked' | 'none';

function sellerKey(seller: SalesTotals['rows'][number]['seller']): SellerKey {
  return seller.kind === 'member' ? `member:${seller.memberId}` : seller.kind;
}

function sellerLabel(key: SellerKey, memberNameOf: MemberNameOf): string {
  if (key === 'agent') return 'L’agent';
  if (key === 'unlinked') return 'Chatteurs non reliés';
  if (key === 'none') return 'Sans chatteur';
  return memberNameOf(key.slice('member:'.length)) ?? 'Un chatteur';
}

/** Members first, then the agent, the unlinked chatters, and no chatter. */
function sellerRank(key: SellerKey): number {
  if (key === 'agent') return 1;
  if (key === 'unlinked') return 2;
  if (key === 'none') return 3;
  return 0;
}

/** A register not read for this long is said not read: the reading runs every minute (ADR 0054). */
const SALES_UNREAD_AFTER_MS = 60 * 60_000;

/** When a register was last read, in her zone: « 21:40 » today, « 02/11 à 21:40 » before. */
function readTime(at: Date, now: Date, timeZone: string): string {
  const day = (date: Date) =>
    date.toLocaleDateString('fr-FR', { timeZone, day: '2-digit', month: '2-digit' });
  const time = at.toLocaleTimeString('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' });
  return day(at) === day(now) ? time : `${day(at)} à ${time}`;
}

/**
 * The evening digest of one creator's day (CRM-04 lot b), in HTML; `null` when none of her accounts is linked to a
 * register (nothing read, nothing to say). Per currency: the « Chiffre d'affaires » (what the fans paid, VAT included,
 * the refunds of the day's own sales taken off), the net, the two shares, the number of sales and refunds; then each
 * seller: a member by name, the agent, the chatters nobody linked, « Sans chatteur »; then the refunds made today of
 * an earlier sale (or one older than the register), which no total of today holds: said apart, never taken off twice.
 * A register not read for an hour says so first (ADR 0054); when none was read, no figure is given, so a day not read
 * never reads as a day without a sale. Never a fan, never a sale's key.
 */
export function eveningDigestText(
  creatorName: string,
  day: SalesDay,
  memberNameOf: MemberNameOf,
  clock: { readonly now: Date; readonly timeZone: string },
): { readonly text: string; readonly summary: string } | null {
  if (day.readings.length === 0) return null;
  const unread = day.readings.filter(
    (reading) =>
      reading.readAt === null || clock.now.getTime() - Date.parse(reading.readAt) > SALES_UNREAD_AFTER_MS,
  );
  const warnings = unread.map((reading) =>
    reading.readAt === null
      ? `⚠️ Ventes ${PLATFORM_NAMES[reading.platform]} jamais lues : chiffres incomplets.`
      : `⚠️ Ventes ${PLATFORM_NAMES[reading.platform]} non lues depuis ${readTime(new Date(reading.readAt), clock.now, clock.timeZone)} : chiffres incomplets.`,
  );
  const title = `💰 <b>Bilan du soir · ${renderPlain(creatorName)} · jusqu’à 23 h</b>`;
  if (unread.length === day.readings.length) {
    return { text: `${title}\n${warnings.map(renderPlain).join('\n')}`, summary: warnings[0] ?? '' };
  }

  const byCurrency = new Map<Currency, { all: Sums; sellers: Map<SellerKey, Sums> }>();
  for (const row of day.totals.rows) {
    let entry = byCurrency.get(row.currency);
    if (entry === undefined) {
      entry = { all: zero(), sellers: new Map() };
      byCurrency.set(row.currency, entry);
    }
    add(entry.all, row);
    const key = sellerKey(row.seller);
    let sums = entry.sellers.get(key);
    if (sums === undefined) {
      sums = zero();
      entry.sellers.set(key, sums);
    }
    add(sums, row);
  }
  // Refunds of an earlier sale, by currency: today's own sales' refunds are already in the totals above.
  const earlier = new Map<Currency, { count: number; gross: number }>();
  for (const row of day.refunds.rows) {
    if (row.sale === 'same_day') continue;
    const sums = earlier.get(row.currency) ?? { count: 0, gross: 0 };
    sums.count += row.refunds;
    sums.gross += row.grossInclVatMinor;
    earlier.set(row.currency, sums);
  }

  const lines: string[] = [];
  const currencies = [...new Set([...byCurrency.keys(), ...earlier.keys()])].sort();
  for (const currency of currencies) {
    const money = (minor: number) => saleAmount(minor, currency);
    if (lines.length > 0) lines.push('');
    const entry = byCurrency.get(currency);
    if (entry !== undefined) {
      const { all } = entry;
      lines.push(`Chiffre d’affaires ${money(all.gross)} · net ${money(all.net)}`);
      lines.push(`Part de l’agence ${money(all.agency)} · part de la créatrice ${money(all.creator)}`);
      lines.push(
        `${plural(all.sales, 'vente', 'ventes')} · ${plural(all.refunds, 'remboursement', 'remboursements')}`,
      );
      // Members first, the best seller at the top (then by name, so the text is stable), then the agent and the rest.
      const sellers = [...entry.sellers].sort(
        ([a, sa], [b, sb]) =>
          sellerRank(a) - sellerRank(b) ||
          sb.gross - sa.gross ||
          sellerLabel(a, memberNameOf).localeCompare(sellerLabel(b, memberNameOf), 'fr'),
      );
      for (const [key, sums] of sellers) {
        const refunds =
          sums.refunds === 0 ? '' : `, ${plural(sums.refunds, 'remboursement', 'remboursements')}`;
        lines.push(
          `${sellerLabel(key, memberNameOf)} : ${money(sums.gross)} (${plural(sums.sales, 'vente', 'ventes')}${refunds})`,
        );
      }
    }
    const refunded = earlier.get(currency);
    if (refunded !== undefined) {
      lines.push(
        `${plural(refunded.count, 'remboursement', 'remboursements')} de ventes d’avant · ${money(-refunded.gross)}`,
      );
    }
  }
  if (lines.length === 0) lines.push('Aucune vente aujourd’hui.');
  const all = [...warnings, ...lines];
  return {
    text: `${title}\n${all.map(renderPlain).join('\n')}`,
    summary: all[0] ?? '',
  };
}
