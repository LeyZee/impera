import {
  CREATOR_MESSAGE_KIND_WORDS,
  PUSH_TITLE_MAX,
  type PushMessage,
  type ToAgencyMessageKind,
} from '@impera/contracts';

/**
 * What a phone says of « Écrire à l'agence » (recette 27/11, G4 and G13), pure: who wrote and what kind, never her
 * words (they stay in Impera, behind a login). Her message rings her owner and her managers; the owner's answer rings
 * her own accounts.
 */

/** « Lina · Une question », to the agency: opens the Dashboard, where her message waits in « À faire ». */
export function toAgencyNotice(creatorName: string, kind: ToAgencyMessageKind): PushMessage {
  return {
    title: `${creatorName} · ${CREATOR_MESSAGE_KIND_WORDS[kind]}`.slice(0, PUSH_TITLE_MAX),
    body: 'Elle a écrit à l’agence : sa demande attend une réponse.',
    url: '/',
  };
}

/** « L'agence t'a répondu », to her: opens Aujourd'hui, where the answer sits under her message. */
export function answerNotice(): PushMessage {
  return {
    title: 'L’agence t’a répondu',
    body: 'Sa réponse est sous ton message, dans Aujourd’hui.',
    url: '/aujourdhui',
  };
}

/** One notification per message and per side: a replay rings nothing twice. */
export const toAgencyKey = (messageId: string): string => `creator-message:${messageId}`;
export const answerKey = (messageId: string): string => `creator-message-answer:${messageId}`;
