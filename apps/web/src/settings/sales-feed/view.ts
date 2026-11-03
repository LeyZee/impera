import type {
  SalesFeedAccountChoice,
  SalesFeedCapability,
  SalesFeedChatterLink,
  SalesFeedModelLink,
  SalesFeedStatus,
  TeamMember,
} from '@impera/contracts';

/** Small view rules of Réglages › Ventes, kept out of the components so they are tested. */

/**
 * The dot of a feed, with the Services page's colours: red when reading stopped (the key must be connected again),
 * amber when the last read hit a passing problem (Reveal busy or away: it resumes on its own), hollow without a key.
 */
export type FeedDot = 'ok' | 'off' | 'low' | 'bad';
export function dotOf(status: SalesFeedStatus): FeedDot {
  if (status.state === 'not_connected') return 'off';
  if (status.state === 'needs_reconnect') return 'bad';
  return status.lastErrorKind === null ? 'ok' : 'low';
}

const DAY_TIME = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** « 2 nov. à 14:05 », « 1er nov. à 09:30 ». */
export function dayTime(iso: string): string {
  const parts = DAY_TIME.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const day = part('day') === '1' ? '1er' : part('day');
  return `${day} ${part('month')} à ${part('hour')}:${part('minute')}`;
}

/** « à l’instant », « il y a 12 min », « il y a 3 h », then the day and the time. */
export function ago(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${String(minutes)} min`;
  if (minutes < 24 * 60) return `il y a ${String(Math.floor(minutes / 60))} h`;
  return `le ${dayTime(iso)}`;
}

/** The line under the name: the server's sentence, then when the register was last read while it is read. */
export function lineOf(status: SalesFeedStatus, now: Date): string {
  if (status.state !== 'connected' || status.lastReadAt === null) return status.message;
  return `${status.message} Dernière lecture ${ago(status.lastReadAt, now)}.`;
}

const CAPABILITIES: Record<SalesFeedCapability, string> = {
  sales: 'Ventes',
  stats: 'Statistiques',
  team: 'Équipe',
  webhooks: 'Réception instantanée',
};
export const capabilityLabel = (capability: SalesFeedCapability): string => CAPABILITIES[capability];

/** The sales of models nobody linked yet: counted nowhere until the owner links them (ADR 0050 § 3). */
export function quarantineLine(count: number): string {
  return count > 1
    ? `${String(count)} ventes attendent un modèle relié : elles ne comptent nulle part tant que tu ne l’as pas relié ci-dessous.`
    : '1 vente attend un modèle relié : elle ne compte nulle part tant que tu ne l’as pas relié ci-dessous.';
}

/** On a model's row: linking it moves these sales into the register, dated when they enter it. */
export function modelQuarantineLine(count: number): string {
  return count > 1
    ? `${String(count)} ventes en attente : relier ce modèle les fait entrer au registre.`
    : '1 vente en attente : relier ce modèle la fait entrer au registre.';
}

/**
 * What the webhook block says. No delivery for hours only means no sale, so silence is never a warning; a refused
 * delivery since it was registered is the one case where the owner has something to do: register it again.
 */
export type WebhookView =
  { kind: 'none' } | { kind: 'active'; line: string } | { kind: 'rejected'; line: string; warning: string };
export function webhookViewOf(webhook: SalesFeedStatus['webhook'], now: Date): WebhookView {
  if (webhook === null) return { kind: 'none' };
  const received =
    webhook.lastDeliveryAt === null
      ? 'aucune vente reçue par ce chemin pour l’instant'
      : `dernière vente reçue ${ago(webhook.lastDeliveryAt, now)}`;
  const line = `Active depuis le ${dayTime(webhook.createdAt)} · ${received}.`;
  if (webhook.lastRejectedAt === null) return { kind: 'active', line };
  return {
    kind: 'rejected',
    line,
    warning: `Un envoi de Reveal a été refusé le ${dayTime(webhook.lastRejectedAt)} : sa signature ne correspond pas au secret gardé. Réinscris le webhook. En attendant, les ventes arrivent toujours dans la minute, rien n’est perdu.`,
  };
}

/** « @messa · Messalina », the creator's name when the account has one. */
export function accountLabel(account: SalesFeedAccountChoice): string {
  return account.creatorDisplayName === ''
    ? `@${account.handle}`
    : `@${account.handle} · ${account.creatorDisplayName}`;
}

/** « Messalina (@messa) », the handle alone when the platform gives no name. */
export function modelLabel(model: SalesFeedModelLink): string {
  return model.displayName === '' ? `@${model.handle}` : `${model.displayName} (@${model.handle})`;
}

/**
 * The accounts a model can take: every account, those already linked to another model shown but not choosable (the
 * server refuses them, `sales_feed_model_conflict`), with the model they count for.
 */
export interface AccountOption {
  readonly value: string;
  readonly label: string;
  readonly disabled: boolean;
}
export function accountOptionsOf(
  model: SalesFeedModelLink,
  accounts: readonly SalesFeedAccountChoice[],
  models: readonly SalesFeedModelLink[],
): AccountOption[] {
  return accounts.map((account) => {
    const value = account.platformAccountId;
    if (account.linkedTo === null || account.linkedTo === model.platformModelId) {
      return { value, label: accountLabel(account), disabled: false };
    }
    const other = models.find((m) => m.platformModelId === account.linkedTo);
    const by = other === undefined ? 'un autre modèle' : `@${other.handle}`;
    return { value, label: `${accountLabel(account)} (relié à ${by})`, disabled: true };
  });
}

export const chatterName = (chatter: SalesFeedChatterLink): string =>
  `${chatter.firstName} ${chatter.lastName}`.trim() || chatter.platformChatterId;

/** The select's value for a chatter's link: `member:<id>`, `agent` or `none`. */
export function chatterValueOf(chatter: SalesFeedChatterLink): string {
  if (chatter.link === null) return 'none';
  return chatter.link.kind === 'agent' ? 'agent' : `member:${chatter.link.memberId}`;
}

/**
 * The members a chatter can be linked to: the team still in it, by name, and the member already linked even if he
 * left (his link stays readable until the owner changes it).
 */
export function memberChoicesOf(members: readonly TeamMember[], linkedId: string | null): TeamMember[] {
  return members
    .filter((member) => member.status !== 'left' || member.id === linkedId)
    .toSorted((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));
}
