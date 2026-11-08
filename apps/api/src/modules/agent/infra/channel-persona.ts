import { PERSONA_SHEET, type ChannelPostViolation, type StoredPersona } from '@impera/contracts';

import { checkExplicit, checkVoiceOutput } from '../domain/guards';

import { guardSettingsOf, personaForModels } from './persona-file';

/** A Telegram caption holds 1 024 characters: a post is one message, read whole by the guards. */
const CHANNEL_GUARD_CHARS = 1024;

/**
 * A public post reads nothing of her intimacy (relecture Agent de #654): what she does in private would pull the model
 * toward what the guards then refuse. Her strict limits stay, so that the post never goes near them.
 */
const PRIVATE_ANSWERS: ReadonlySet<string> = new Set(
  PERSONA_SHEET.filter((section) => section.key === 'intimacy')
    .flatMap((section) => section.questions.map((question) => question.key))
    .filter((key) => key !== 'no_go_zones'),
);

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
  const persona = personaForModels(
    stored.persona,
    stored.creatorName,
    now.toISOString().slice(0, 10),
    PRIVATE_ANSWERS,
  );
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
