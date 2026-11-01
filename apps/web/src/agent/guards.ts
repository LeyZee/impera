import type { GuardCode } from '@nirvana/contracts';

/*
 * The agent's guards in words (`GUARD_CODES`, docs/architecture/ai-engine.md « Les gardes »), as a sentence names what
 * a refused draft held: « Ce message ne peut pas partir : une didascalie (« *sourit* », « (rires) »). » Every code of
 * the closed list has its noun phrase, the soft ones too: they ask for a regeneration and never refuse an approval,
 * but a code the server sends is never left unsaid.
 */
export const GUARD_LABELS: Readonly<Record<GuardCode, string>> = {
  ai_disclosure: 'un aveu d’IA',
  love_declaration: 'une déclaration d’amour',
  meeting_promise: 'une promesse de rencontre',
  contact_info: 'des coordonnées',
  assistant_output: 'un ton d’assistant',
  ai_tic: 'un tic d’IA',
  forbidden_term: 'un mot que la créatrice refuse',
  too_many_bubbles: 'trop de bulles',
  bubble_too_long: 'une bulle trop longue',
  asks_for_nudes: 'une demande de photos',
  contempt: 'du mépris',
  payment_lie: 'un mensonge sur un paiement',
  discount: 'une remise ou une négociation',
  explicit_before_age: 'du contenu explicite avant l’âge confirmé',
  guilt_trip: 'de la culpabilisation',
  pet_name: 'un petit nom qu’elle n’emploie pas',
  stage_direction: 'une didascalie (« *sourit* », « (rires) »)',
  media_not_sent: 'un média annoncé qui n’est pas joint',
  platform_meeting_word: 'un mot de rencontre que Reveal repère',
  fake_emergency: 'une maladie, une dette ou une urgence pour vendre',
  repetition: 'une phrase déjà dite',
  closed_question_streak: 'trop de questions fermées d’affilée',
};
