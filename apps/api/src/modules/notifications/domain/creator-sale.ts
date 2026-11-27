import type { Currency, PushMessage } from '@impera/contracts';

/**
 * What a creator's phone says of a fresh sale (CRM-04 lot d2, ADR 0042 § 7), pure: her part (`modelRevenue` on Reveal)
 * and nothing else. Never the fan, nor who sold, nor the agent (ADR 0021, ADR 0042 § 2), nor the price the fan paid.
 */

const AMOUNT: Readonly<Record<Currency, Intl.NumberFormat>> = {
  EUR: new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }),
  USD: new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' }),
};

/** Her Ventes screen, the tab of her bar (ADR 0042 § 8). */
const SALES_SCREEN = '/ventes';

/**
 * « Nouvelle vente · 12,40 € pour toi »: her part, cents always shown, in the title, which is what her list of
 * notifications keeps (fourteen « Nouvelle vente » alike said nothing, recette 27/11, G4). No tag, so two sales show
 * as two.
 */
export function creatorSaleMessage(creatorMinor: number, currency: Currency): PushMessage {
  const part = `${AMOUNT[currency].format(creatorMinor / 100)} pour toi`;
  return {
    title: `Nouvelle vente · ${part}`,
    body: 'Le détail est dans tes ventes.',
    url: SALES_SCREEN,
  };
}
