import {
  DomainError,
  type Destination,
  type PlaygroundAnswer,
  type DesireMarkVerdict,
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
  /** « Payer (fictif) » on the paid step of a trial script waiting for him (ADR 0103 § 16); nothing reaches Reveal. */
  buyScriptStep(): PlaygroundState;
  /** « Refuser » the paid step waiting: an explicit refusal, the script stops there. */
  refuseScriptStep(): PlaygroundState;
  /** Reads her catalogue now, as his next message would: the screen says at once whether she has a script to sell. */
  readScripts(): Promise<void>;
  /** The owner marks his desire score after his n-th message (ADR 0103 § 6); kept for a creator's version only. */
  markDesire(
    fanMessageNumber: number,
    mark: { readonly verdict: DesireMarkVerdict; readonly note?: string },
    userId: string,
  ): Promise<PlaygroundState>;
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

/** « Payer (fictif) » or « Refuser » with no paid step waiting for him (already decided, or the script ended). */
export class ScriptStepNotWaiting extends PlaygroundError {
  constructor() {
    super('script_step_not_waiting_conflict', 'Aucune étape payante n’attend de réponse.');
  }
}

/** « Payer (fictif) » once a possible minor or his distress froze his sales: production would never sell then. */
export class ScriptSalesFrozen extends PlaygroundError {
  constructor() {
    super('script_sales_frozen_conflict', 'Ventes gelées pour ce fan : aucun achat, même fictif.');
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

/** No version of hers under this id (recette PRO-21): another creator's, or one that never was. */
export class PlaygroundPersonaNotFound extends PlaygroundError {
  constructor() {
    super('playground_persona_not_found', 'Cette version de persona n’existe pas pour cette créatrice.');
  }
}

/** The invented persona belongs to no creator: its conversations, and so its marks, are not kept (ADR 0103 § 7). */
export class DesireMarkInventedPersona extends PlaygroundError {
  constructor() {
    super(
      'desire_mark_invented_persona_conflict',
      'La persona fictive n’est pas gardée : choisis une version d’une créatrice pour noter le désir.',
    );
  }
}

/** No example of hers in her bank under this id: withdrawn already, another creator's, or never filed (ADR 0102 § 5). */
export class VoiceExampleNotFound extends PlaygroundError {
  constructor() {
    super('voice_example_not_found', 'Cet exemple n’est plus dans sa banque.');
  }
}
