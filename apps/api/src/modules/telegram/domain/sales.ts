import {
  DEFAULT_TELEGRAM_SALE_SETTINGS,
  type CreatorId,
  type Currency,
  type SalesTotals,
  type TelegramSaleSettings,
  type TelegramSaleSettingsEntry,
} from '@nirvana/contracts';

import type { MemberNameOf } from './classify';
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

/** A fresh sale rings at or above the minimum price (VAT included), and only the agent's when the owner said so. */
export function saleRings(settings: TelegramSaleSettings, signal: Signal & { kind: 'sale' }): boolean {
  if (settings.agentOnly && signal.seller.kind !== 'agent') return false;
  return signal.grossInclVatMinor >= settings.minimumMinor;
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

/**
 * The evening digest of one creator's day (CRM-04 lot b), in HTML: per currency, the « Chiffre d'affaires » (what the
 * fans paid, VAT included, refunds taken off), the net, the two shares, the number of sales and refunds; then each
 * seller: a member by name, the agent, the chatters nobody linked, « Sans chatteur ». Never a fan, never a sale's key.
 */
export function eveningDigestText(
  creatorName: string,
  totals: SalesTotals,
  memberNameOf: MemberNameOf,
): { readonly text: string; readonly summary: string } {
  const byCurrency = new Map<Currency, { all: Sums; sellers: Map<SellerKey, Sums> }>();
  for (const row of totals.rows) {
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

  const lines: string[] = [];
  const currencies = [...byCurrency.keys()].sort();
  for (const currency of currencies) {
    const entry = byCurrency.get(currency);
    if (entry === undefined) continue;
    const money = (minor: number) => saleAmount(minor, currency);
    const { all } = entry;
    if (lines.length > 0) lines.push('');
    lines.push(`Chiffre d’affaires ${money(all.gross)} · net ${money(all.net)}`);
    lines.push(`Part de l’agence ${money(all.agency)} · part de la créatrice ${money(all.creator)}`);
    lines.push(
      `${plural(all.sales, 'vente', 'ventes')} · ${plural(all.refunds, 'remboursement', 'remboursements')}`,
    );
    const sellers = [...entry.sellers].sort(([a], [b]) => sellerRank(a) - sellerRank(b));
    for (const [key, sums] of sellers) {
      const refunds =
        sums.refunds === 0 ? '' : `, ${plural(sums.refunds, 'remboursement', 'remboursements')}`;
      lines.push(
        `${sellerLabel(key, memberNameOf)} : ${money(sums.gross)} (${plural(sums.sales, 'vente', 'ventes')}${refunds})`,
      );
    }
  }
  if (lines.length === 0) lines.push('Aucune vente aujourd’hui.');
  if (totals.refundsWithoutSale > 0) {
    lines.push(
      `${plural(totals.refundsWithoutSale, 'remboursement', 'remboursements')} d’une vente plus ancienne que le registre, hors totaux.`,
    );
  }
  return {
    text: `💰 <b>Bilan du soir · ${renderPlain(creatorName)}</b>\n${lines.map(renderPlain).join('\n')}`,
    summary: lines[0] ?? '',
  };
}
