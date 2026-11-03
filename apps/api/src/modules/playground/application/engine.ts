import {
  DomainError,
  type Destination,
  type PlaygroundAnswer,
  type PlaygroundComparison,
  type PlaygroundErrorCode,
  type PlaygroundMedia,
  type PlaygroundRatingResult,
  type PlaygroundSituationPatch,
  type PlaygroundState,
  type Verdict,
} from '@impera/contracts';

/**
 * One trainer's playground: the P3-05 engine seen through the API's DTOs. The infra implements it over the
 * LLM gateway; the application only keeps one per user and maps its errors.
 */
export interface PlaygroundEngine {
  state(): PlaygroundState;
  applyPreset(presetId: string): PlaygroundState;
  reset(): PlaygroundState;
  send(text: string, media: readonly PlaygroundMedia[]): Promise<PlaygroundAnswer>;
  rate(verdict: Verdict, destination?: Destination): Promise<PlaygroundRatingResult>;
  branch(fanMessageNumber: number): Promise<PlaygroundState>;
  compare(voiceModel: string): Promise<PlaygroundComparison>;
  patchSituation(patch: PlaygroundSituationPatch): PlaygroundState;
  advance(hours: number): PlaygroundState;
  setNotes(notes: readonly string[]): PlaygroundState;
  sendCreatorMedia(media: PlaygroundMedia, isLocked: boolean): PlaygroundState;
}

/** Every error of the playground carries one of the codes the contract lists for the screen. */
class PlaygroundError extends DomainError {
  protected constructor(code: PlaygroundErrorCode, message: string) {
    super(code, message);
  }
}

/** No key reaches the voice model, main or fallback: the screen asks for the Grok key (503, set by the route). */
export class LlmUnavailable extends PlaygroundError {
  constructor() {
    super(
      'llm_unavailable',
      'Aucun modèle de voix n’est joignable : ajoute la clé Grok dans Réglages > Modèles IA.',
    );
  }
}

export class NothingToRate extends PlaygroundError {
  constructor() {
    super('nothing_to_rate_conflict', 'Rien à noter : envoie d’abord un message.');
  }
}

export class NothingToCompare extends PlaygroundError {
  constructor() {
    super(
      'nothing_to_compare_conflict',
      'Rien à comparer : la dernière réponse n’a pas été écrite par la voix.',
    );
  }
}

/** One answer at a time per trainer: a second send while the first runs would mix the two turns. */
export class AnswerInProgress extends PlaygroundError {
  constructor() {
    super('answer_in_progress_conflict', 'Une réponse est en cours : attends-la.');
  }
}

export class BlockedAnswer extends PlaygroundError {
  constructor() {
    super('blocked_answer_conflict', 'Réponse bloquée par les gardes : corrige-la ou rejette-la.');
  }
}

export class PresetNotFound extends PlaygroundError {
  constructor() {
    super('preset_not_found', 'Ce fan préréglé n’existe pas.');
  }
}

export class FanMessageNotFound extends PlaygroundError {
  constructor() {
    super('fan_message_not_found', 'Ce message du fan n’existe pas dans la conversation.');
  }
}

export class VoiceModelInvalid extends PlaygroundError {
  constructor() {
    super('voice_model_invalid', 'Modèle de voix inconnu.');
  }
}

export class TimeZoneInvalid extends PlaygroundError {
  constructor() {
    super('time_zone_invalid', 'Fuseau horaire inconnu : un nom comme Europe/Paris.');
  }
}
