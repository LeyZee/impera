import type { ChannelPostViolation, GuardCode } from '@impera/contracts';

import { GUARD_LABELS } from '@/agent/guards';

/** What a guard means on a public channel: the agent's words say a fan's conversation. */
const CHANNEL_GUARD_LABELS: Partial<Readonly<Record<GuardCode, string>>> = {
  explicit_before_age: 'du contenu explicite sur un canal public',
  bubble_too_long: 'un post plus long que Telegram ne l’accepte',
  contact_info: 'une adresse dans le texte (le lien vient à la fin)',
};

/** A guard raised on her post, said as the preview says it. */
export const violationLabel = (violation: ChannelPostViolation): string =>
  `${violation.blocking ? 'Ne partirait pas' : 'À revoir'} : ${
    CHANNEL_GUARD_LABELS[violation.code] ?? GUARD_LABELS[violation.code]
  }${violation.match === null ? '' : ` (« ${violation.match} »)`}.`;
