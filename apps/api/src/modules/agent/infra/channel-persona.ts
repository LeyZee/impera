import {
  asPersonaV2,
  COMMENT_REPLY_MAX,
  PERSONA_SHEET,
  type ChannelPostViolation,
  type StoredPersona,
} from '@impera/contracts';

import { checkExplicit, checkVoiceOutput } from '../domain/guards';
import { checkPlaceNames, placeNames } from '../domain/place-names';

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

interface PublicWriterPersona {
  readonly version: string;
  readonly creatorName: string;
  readonly personaSheet: string;
  check(texts: readonly string[]): ChannelPostViolation[];
}

/**
 * Who she is for anything she writes in public, read as her drafts read her but without her intimacy, and her guards
 * on its words: the agent's, nothing explicit, and never a place where she lives (ADR 0080 § 5.9). One list of what stays private for every public surface, so that
 * none drifts from the others; `maxChars` is the longest text the surface holds.
 */
function publicWriterPersona(
  stored: StoredVersion,
  now: Date,
  options: { readonly maxChars: number },
): PublicWriterPersona {
  const persona = personaForModels(
    stored.persona,
    stored.creatorName,
    now.toISOString().slice(0, 10),
    PRIVATE_ANSWERS,
  );
  const settings = { ...guardSettingsOf(persona), maxBubbleChars: options.maxChars };
  // Her town and her « lieu de vie », left out while still a placeholder of the sheet.
  const { city, place_of_life: placeOfLife } = asPersonaV2(stored.persona).sheet.identity;
  const places = placeNames([city, placeOfLife].map((answer) => (answer?.startsWith('<') ? null : answer)));
  return {
    version: stored.version,
    creatorName: persona.creatorName,
    personaSheet: persona.personaSheet,
    check: (texts) =>
      [
        ...checkVoiceOutput(texts, { ...settings, maxBubbles: texts.length }),
        ...checkExplicit(texts),
        ...checkPlaceNames(texts, places),
      ].map((violation) => ({
        code: violation.code,
        blocking: violation.severity === 'blocking',
        match: violation.match ?? null,
      })),
  };
}

/**
 * Who she is for a post of her Telegram channel (ADR 0080 § 5): the channel is public (§ 5.4). The `telegram`
 * module's port, wired by the composition root.
 */
export function channelWriterPersona(stored: StoredVersion, now: Date): PublicWriterPersona {
  return publicWriterPersona(stored, now, { maxChars: CHANNEL_GUARD_CHARS });
}

/**
 * Who she is for a reply to a comment under one of her Instagram posts (ADR 0122 § 2): her public panels only, and
 * the same guards on a text as short as a reply. The `instagram-comments` module's port, wired by the composition root.
 */
export function commentWriterPersona(stored: StoredVersion, now: Date): PublicWriterPersona {
  return publicWriterPersona(stored, now, { maxChars: COMMENT_REPLY_MAX });
}
