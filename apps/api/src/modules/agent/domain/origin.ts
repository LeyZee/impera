import type { MessageOrigin } from '@impera/contracts';

/**
 * What the brain and the voice read of a message an automation of the platform wrote, or of his reply to a story
 * (ADR 0110 § 1, 3, 4): written by code, never by him. On his turns it stands in brackets before his block; on hers it
 * goes to « le moment », so her own turns never carry a bracket to imitate.
 */
const NOTES: Readonly<Record<MessageOrigin, string>> = {
  hook: 'accroche toute faite que la plateforme lui a proposée à son abonnement, choisie d’un clic : pas ses mots, n’en tire rien sur lui',
  story_reply: 'il répond à une de tes stories, que tu ne vois pas',
  welcome: 'Ta bienvenue automatique, partie à son abonnement, est dans l’historique : ne la répète pas.',
  expiration_reminder:
    'Ton rappel automatique avant la fin de son abonnement est dans l’historique : ne le répète pas.',
};

/** Whether a turn is an opener he chose (ADR 0110 § 1), by the note code put on it: not his words. */
export function isOpener(turn: { readonly originNote?: string }): boolean {
  return turn.originNote === NOTES.hook;
}

export function originNote(origin: MessageOrigin | null | undefined): string | undefined {
  return origin === null || origin === undefined ? undefined : NOTES[origin];
}
