import {
  DEFAULT_TELEGRAM_CHANNEL_CONFIG,
  err,
  ok,
  type ChannelPostDraft,
  type ChannelTryRefusalKind,
  type CreatorId,
  type Result,
  type TriedChannelPost,
  type TryChannelPostBody,
} from '@impera/contracts';

import { channelChecks, guardedTexts, linkOf, renderChannelPost } from '../domain/channel-post';
import type { ChannelPersonaSource, ChannelsStore, ChannelVoice } from '../domain/ports';

/**
 * A post of her channel written as production will write it (ADR 0080 § 5), for the playground's « Post du canal »
 * (§ 7): the main post, an engagement post or a poll; her persona, her examples, where the link leads, the agency's
 * advice, then the guards. Nothing is sent.
 */
export interface ChannelPostDeps {
  readonly channels: ChannelsStore;
  readonly persona: ChannelPersonaSource;
  readonly voice: ChannelVoice;
}

/** Null when she does not exist or is archived. */
export async function tryChannelPost(
  deps: ChannelPostDeps,
  creatorId: CreatorId,
  body: TryChannelPostBody,
): Promise<Result<TriedChannelPost, ChannelTryRefusalKind> | null> {
  if (!(await deps.channels.creatorActive(creatorId))) return null;
  const config = (await deps.channels.findChannel(creatorId))?.config ?? DEFAULT_TELEGRAM_CHANNEL_CONFIG;
  // Only the main post carries a link (§ 5.8): an engagement post or a poll has none, whatever was asked.
  const main = body.kind === 'main';
  const linkId = main ? (body.linkId ?? config.channelLinkId) : null;
  const link = linkId === null ? null : (config.links.find((one) => one.id === linkId) ?? null);
  if (main && body.linkId !== null && link === null) return err('link_unknown');

  const persona = await deps.persona(creatorId);
  if (persona === null) return err('no_persona');
  const written = await deps.voice({
    creatorId,
    kind: body.kind,
    creatorName: persona.creatorName,
    personaSheet: persona.personaSheet,
    examples: config.examples,
    media: body.kind === 'poll' ? null : body.media,
    destination: link?.destination ?? null,
    advice: body.advice,
  });
  if (written === null) return err('llm_unavailable');

  const draft: ChannelPostDraft =
    written.kind === 'post'
      ? renderChannelPost(written.text, link === null ? null : linkOf(config, link))
      : { kind: 'poll', question: written.question, options: [...written.options] };
  return ok({
    draft,
    violations: [...persona.check(guardedTexts(draft)), ...channelChecks(draft)],
    personaVersion: persona.version,
  });
}
