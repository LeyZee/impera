import type { ChannelPostViolation, StoredPersona } from '@impera/contracts';

import { checkExplicit, checkVoiceOutput } from '../domain/guards';

import { guardSettingsOf, personaForModels } from './persona-file';

/** A Telegram caption holds 1 024 characters: a post is one message, read whole by the guards. */
const CHANNEL_GUARD_CHARS = 1024;

/** Her active persona version as the `persona` module stores it (`versions.active`), matched by shape. */
interface StoredVersion {
  readonly version: string;
  readonly creatorName: string;
  readonly persona: StoredPersona;
}

/**
 * Who she is for a post of her Telegram channel (ADR 0080 § 5), read as her drafts read her, and her guards on its
 * words: the agent's, and nothing explicit, since the channel is public (§ 5.4). The `telegram` module's port, wired
 * by the composition root.
 */
export function channelWriterPersona(
  stored: StoredVersion,
  now: Date,
): {
  readonly version: string;
  readonly creatorName: string;
  readonly personaSheet: string;
  check(texts: readonly string[]): ChannelPostViolation[];
} {
  const persona = personaForModels(stored.persona, stored.creatorName, now.toISOString().slice(0, 10));
  const settings = { ...guardSettingsOf(persona), maxBubbleChars: CHANNEL_GUARD_CHARS };
  return {
    version: stored.version,
    creatorName: persona.creatorName,
    personaSheet: persona.personaSheet,
    check: (texts) =>
      [...checkVoiceOutput(texts, { ...settings, maxBubbles: texts.length }), ...checkExplicit(texts)].map(
        (violation) => ({
          code: violation.code,
          blocking: violation.severity === 'blocking',
          match: violation.match ?? null,
        }),
      ),
  };
}
