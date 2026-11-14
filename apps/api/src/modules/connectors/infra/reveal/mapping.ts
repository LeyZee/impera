import type {
  ConversationSnapshot,
  Currency,
  ExternalMessage,
  ExternalRef,
  ExternalTransaction,
  FanPpvStats,
  FanProfile,
  PlatformMedia,
  PlatformScript,
  PlatformScriptStep,
  SentScriptStep,
  VaultMedia,
} from '@impera/contracts';

import type { RevealAnswer as Answer } from './wire';

/**
 * Reveal's answers in the port's words (reveal-connector-spec.md §§ 4, 6). Pure: no call, no clock. Nothing Reveal
 * names leaves this adapter.
 */

type ConversationItem = Answer<'conversations.get'>;
type MessageItem = Answer<'messages.list'>['data'][number];
type WireMedia = MessageItem['medias'][number];
type WireTransaction = Answer<'transactions.list'>['data'][number];
type PpvBundle = Answer<'conversations.ppvHistory'>['bundles'][number];
type ScriptItem = Answer<'scripts.list'>['data'][number];
type SequenceItem = Answer<'scriptSequences.list'>[number];
type VaultFolder = Answer<'vault.folders'>[number];
type VaultItem = Answer<'vault.medias'>['data'][number];

/** Reveal prices in euro cents, VAT included (capture). */
const REVEAL_CURRENCY: Currency = 'EUR';

const ref = (id: string): ExternalRef => ({ platform: 'reveal', id });

const KINDS = { photo: 'image', video: 'video', audio: 'audio' } as const;

function mediaOf(media: WireMedia): PlatformMedia {
  return { ref: ref(media.id), kind: KINDS[media.type] };
}

/** `listConversations`: Reveal gives no unread count, only whether the team has an unread message (spec § 4). */
export function snapshotOf(item: ConversationItem): ConversationSnapshot {
  const { conversation, lastMessage, member } = item;
  return {
    ref: ref(conversation.id),
    fanRef: ref(member.id),
    fanDisplayName: conversation.memberFirstname ?? member.userName,
    unreadCount: conversation.modelIsUnread ? 1 : 0,
    lastMessageAt: lastMessage?.createdAt ?? conversation.lastMessageAt,
    ...(lastMessage === null ? {} : { lastMessagePreview: lastMessage.content }),
  };
}

/**
 * How the adapter knows its own messages (spec § 4): by id first, the ids of what it sent (`connector_sends`, P2-03);
 * by the « bot » member's display name only as a fallback, for a send whose answer was lost.
 */
export interface OwnMessages {
  readonly ids: ReadonlySet<string>;
  /** `null` while the « bot » member's name is not known: then only ids count. */
  readonly botDisplayName: string | null;
}

/**
 * `fetchMessages`: a message whose author carries a `memberId` is the fan's; any other was written on the creator's
 * side: by the « bot » member (ours, `ai`), or by the creator herself or a chatter (`human`). A bundle's media are
 * locked until it is bought (`isPaid` absent while locked).
 */
export function messageOf(
  item: MessageItem,
  conversationRef: ExternalRef,
  own: OwnMessages,
): ExternalMessage {
  const { message, authorMessage, bundleWithMedias } = item;
  const inbound = authorMessage.memberId !== undefined;
  const bundle = bundleWithMedias?.bundle;
  const isPaid = bundle?.isPaid === true;
  const ours =
    !inbound &&
    (own.ids.has(message.id) ||
      (own.botDisplayName !== null && authorMessage.displayName === own.botDisplayName));
  return {
    ref: ref(message.id),
    conversationRef,
    direction: inbound ? 'inbound' : 'outbound',
    text: message.content,
    media: [
      ...item.medias.map((media) => ({ ...mediaOf(media), isLocked: false })),
      ...(bundleWithMedias?.medias ?? []).map((media) => ({ ...mediaOf(media), isLocked: !isPaid })),
    ],
    priceMinor: bundle?.price ?? null,
    currency: bundle === undefined ? null : REVEAL_CURRENCY,
    isPaid,
    ...(inbound ? {} : { senderLabel: authorMessage.displayName }),
    author: inbound ? 'fan' : ours ? 'ai' : 'human',
    createdAt: message.createdAt,
  };
}

/**
 * `listTransactions`. Reveal's `type` values were masked in the capture: `bundle`, `tip` and `subscription` are
 * FakeReveal's guesses, anything else reads as `other` (spec § 4, open n° 3).
 */
export function transactionOf(transaction: WireTransaction): ExternalTransaction {
  const kinds: Readonly<Record<string, ExternalTransaction['kind']>> = {
    bundle: 'ppv',
    tip: 'tip',
    subscription: 'subscription',
  };
  return {
    ref: ref(transaction.id),
    fanRef: ref(transaction.memberId),
    kind: kinds[transaction.type] ?? 'other',
    amountMinor: transaction.amount,
    currency: REVEAL_CURRENCY,
    createdAt: transaction.createdAt,
  };
}

/** `getFanProfile`, from the conversation item and its stats. */
export function profileOf(item: ConversationItem, stats: Answer<'conversations.stats'>): FanProfile {
  return {
    fanRef: ref(item.member.id),
    joinedAt: stats.memberCreatedAt,
    subscribedAt: stats.firstSubscriptionAt,
    subscriptionEndsAt: stats.subscriptionExpireAt,
    autoRenew: stats.autoRenew,
    totalSpentMinor: stats.totalSpent,
    currency: REVEAL_CURRENCY,
    lastPaidAt: stats.lastPaidAt,
    cardVerifiedAt: item.member.cardVerifiedAt ?? null,
  };
}

/**
 * `getFanPpvStats`: the buy rate, the price range and the last offer of the priced bundles (`kind=paid`), and every
 * bundle, priced and free, newest first.
 */
export function ppvStatsOf(
  paid: { readonly first: Answer<'conversations.ppvHistory'>; readonly bundles: readonly PpvBundle[] },
  free: readonly PpvBundle[],
): FanPpvStats {
  return {
    purchased: paid.first.buyRate.purchased,
    offered: paid.first.buyRate.total,
    highestPriceMinor: paid.first.highestPrice,
    lowestPriceMinor: paid.first.lowestPrice,
    currency: REVEAL_CURRENCY,
    // The newest `createdAt` of the priced bundles (`kind=paid`): Reveal gives no field of its own for it.
    lastOfferAt: paid.bundles.reduce<string | null>(
      (last, bundle) => (last === null || bundle.createdAt > last ? bundle.createdAt : last),
      null,
    ),
    bundles: [...paid.bundles, ...free]
      .map((bundle) => ({
        ref: ref(bundle.id),
        priceMinor: bundle.price,
        isPaid: bundle.isPaid,
        sentAt: bundle.createdAt,
        media: bundle.medias.map(mediaOf),
      }))
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt)),
  };
}

/** ☀️ (with or without its variation selector) and 🌙, as the agency writes them in names (spec § 6). */
function marksIn(name: string): { readonly day: boolean; readonly night: boolean } {
  return { day: name.includes('\u2600'), night: name.includes('\u{1F319}') };
}

/**
 * A script's moment (spec § 6): its own name says it; failing that, the vault folders of the media it sells, when
 * they agree. A name that says both gives `null`, as do folders that disagree or say nothing.
 */
export function momentOf(name: string, folderNames: readonly string[]): PlatformScript['moment'] {
  const own = marksIn(name);
  if (own.day || own.night) return own.day === own.night ? null : own.day ? 'day' : 'night';
  const day = folderNames.some((folder) => marksIn(folder).day);
  const night = folderNames.some((folder) => marksIn(folder).night);
  if (day === night) return null;
  return day ? 'day' : 'night';
}

type StepSource = Pick<ScriptItem, 'medias' | 'teasingMedias'> & { readonly script: ScriptItem['script'] };

function stepOf(source: StepSource, index: number): PlatformScriptStep {
  return {
    ref: ref(source.script.id),
    index,
    name: source.script.name,
    text: source.script.content,
    media: source.medias.map(mediaOf),
    previewMedia: source.teasingMedias.map(mediaOf),
    // Absent = free (spec § 6).
    priceMinor: source.script.price ?? 0,
    currency: REVEAL_CURRENCY,
  };
}

/**
 * `listPlatformScripts` (spec § 6): in the API a « script » is one step and a sequence orders them. A sequence is one
 * script, its steps in `stepIndex` order; a step in no sequence is a script of one step. An empty sequence is left out.
 * `folderOf` names the vault folder of a media, `null` when none.
 */
export function scriptsOf(
  sequences: readonly SequenceItem[],
  steps: readonly ScriptItem[],
  folderOf: (mediaId: string) => string | null,
): PlatformScript[] {
  const folders = (sources: readonly StepSource[]): string[] =>
    sources.flatMap((source) => source.medias.map((media) => folderOf(media.id) ?? ''));
  const inSequence = new Set<string>();
  const scripts: PlatformScript[] = [];
  for (const { sequence, steps: ordered } of sequences) {
    const sorted = [...ordered].sort((a, b) => a.step.stepIndex - b.step.stepIndex);
    const [first, ...rest] = sorted.map((source, index) => stepOf(source, index));
    if (first === undefined) continue;
    for (const source of sorted) inSequence.add(source.script.id);
    scripts.push({
      ref: ref(sequence.id),
      name: sequence.name,
      moment: momentOf(sequence.name, folders(sorted)),
      steps: [first, ...rest],
    });
  }
  for (const step of steps) {
    if (inSequence.has(step.script.id)) continue;
    scripts.push({
      ref: ref(step.script.id),
      name: step.script.name,
      moment: momentOf(step.script.name, folders([step])),
      steps: [stepOf(step, 0)],
    });
  }
  return scripts;
}

/**
 * `getScriptHistory` (spec § 6): with `conversationId`, a step lists the conversation once per send; it was sent to
 * this fan when the list is not empty, and bought when one of those sends was paid.
 */
export function sentStepsOf(items: readonly ScriptItem[]): SentScriptStep[] {
  return items
    .filter((item) => item.conversations.length > 0)
    .map((item) => ({
      stepRef: ref(item.script.id),
      purchased: item.conversations.some((conversation) => conversation.isPaid),
    }));
}

/**
 * `listVaultMedia`: one media of the vault, with the folder it was listed in (`null` for the vault's root) and its rank
 * in that folder's list as Reveal returned it (ADR 0099 § 3). The suggested range is kept only when both ends are given.
 */
export function vaultMediaOf(media: VaultItem, folder: VaultFolder | null, position: number): VaultMedia {
  const min = media.suggestedMinPrice;
  const max = media.suggestedMaxPrice;
  return {
    ref: ref(media.id),
    kind: KINDS[media.type],
    folder:
      folder === null ? null : { ref: ref(folder.id), name: folder.name, moment: momentOf(folder.name, []) },
    folderPosition: position,
    durationSeconds: media.durationSeconds ?? null,
    createdAt: media.createdAt,
    description: media.description === null || media.description.trim() === '' ? null : media.description,
    suggestedPriceMinor: min === null || max === null || min < 0 || max < 0 ? null : { min, max },
  };
}
