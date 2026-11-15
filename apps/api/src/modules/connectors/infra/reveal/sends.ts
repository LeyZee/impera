import { createHash } from 'node:crypto';

import type { RevealAnswer } from './wire';

type MessageItem = RevealAnswer<'messages.list'>['data'][number];

/** What a send carries, as far as its fingerprint goes (spec § 5): the text, the script step and the media sold. */
export interface SendContent {
  readonly text: string;
  /** The Reveal step (`scriptId`) of a script step send; `null` otherwise. */
  readonly scriptRef: string | null;
  readonly mediaIds: readonly string[];
}

/**
 * The fingerprint kept in `connector_sends` (spec § 5): SHA-256 of the text, the `scriptId` and the media, in an
 * order that never depends on how the media were listed. Never the text itself. A script step's text is the step's
 * own, named by its `scriptId`, and Reveal may fill its `%NAME%` (fake-reveal.md): it is left out, so the step read
 * back still has its fingerprint.
 */
export function fingerprintOf(content: SendContent): string {
  const text = content.scriptRef === null ? content.text : '';
  return createHash('sha256')
    .update(JSON.stringify([text, content.scriptRef, [...content.mediaIds].sort()]))
    .digest('hex');
}

/**
 * The fingerprint a message read back from Reveal would have had, were it the send of `scriptRef`: Reveal does not
 * say which step a message came from, so the step is taken from the attempt being checked.
 */
function readFingerprintOf(item: MessageItem, scriptRef: string | null): string {
  return fingerprintOf({
    text: item.message.content,
    scriptRef,
    mediaIds: [...item.medias, ...(item.bundleWithMedias?.medias ?? [])].map((media) => media.id),
  });
}

/** A clock between us and Reveal may drift: a message dated this much before the attempt can still be it. */
const CLOCK_SKEW_MS = 60_000;

/**
 * Whether a message read back is the send of an attempt (spec § 5, point 3): sent by the creator's side, not already
 * known as another send of ours, the attempt's fingerprint, and dated after the attempt started (clock skew aside).
 * The « bot » member's name narrows it when known; Reveal gives no member id on the creator's side.
 */
export function isSendOf(
  item: MessageItem,
  attempt: { readonly fingerprint: string; readonly scriptRef: string | null; readonly startedAt: Date },
  context: { readonly claimed: ReadonlySet<string>; readonly botDisplayName: string | null },
): boolean {
  if (item.authorMessage.memberId !== undefined) return false;
  if (context.claimed.has(item.message.id)) return false;
  if (context.botDisplayName !== null && item.authorMessage.displayName !== context.botDisplayName)
    return false;
  if (Date.parse(item.message.createdAt) < attempt.startedAt.getTime() - CLOCK_SKEW_MS) return false;
  return readFingerprintOf(item, attempt.scriptRef) === attempt.fingerprint;
}
