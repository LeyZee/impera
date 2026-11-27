import type { GuardCode } from '@impera/contracts';

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
  off_platform_payment: 'un paiement hors de la plateforme',
  price_outside_offer: 'un prix écrit hors offre',
  false_scarcity: 'une fausse urgence (« dernière chance », « plus que 3 places »)',
  no_commitment: 'un engagement sur une demande sur mesure (un oui, un prix ou un délai)',
  explicit_before_age: 'du contenu explicite avant l’âge confirmé',
  guilt_trip: 'de la culpabilisation',
  pet_name: 'un petit nom qu’elle n’emploie pas',
  stage_direction: 'une didascalie (« *sourit* », « (rires) »)',
  media_not_sent: 'un média annoncé qui n’est pas joint',
  // Obsolete since 02/11 (`OBSOLETE_GUARD_CODES`): kept because every code needs its words; no server sends it any more.
  platform_meeting_word: 'un mot de rencontre',
  fake_emergency: 'une maladie, une dette ou une urgence pour vendre',
  repetition: 'une phrase déjà dite',
  closed_question_streak: 'trop de questions fermées d’affilée',
  care_breach: 'une vente, une rencontre ou un mot sexuel dans une réponse de soin',
  place_named: 'le nom d’un lieu où elle vit (sa ville, son quartier)',
  minor_reference: 'un enfant ou un mineur nommé, pour rire ou dans un contexte sexuel',
  youth_word_in_sex: 'un mot de jeunesse (« petite », « jeunette »…) dans un message sexuel',
  degrading_word: 'une insulte dégradante de sa liste (fiche persona) dans ses mots à elle',
  moan_below_peak: 'des bruits écrits de plaisir avant le plus fort de l’action',
  mood_killer: 'un sujet qui casse le sexto (ses animaux, la compagne du fan, un autre homme, l’argent)',
  purchase_sweetener: 'un cadeau, un bonus ou un extra promis pour décrocher un achat',
  address_word: 'le mot « adresse » (« mon adresse », « mon adresse mail »), sans l’adresse elle-même',
  belittling_name: 'un nom qui le rabaisse (« petit garçon », « vilain garçon »)',
  unwarranted_brake: 'un frein (« tu y vas un peu fort », « tu vises direct ») sur un simple compliment',
  emoji_misuse:
    'des emojis hors règle : ailleurs qu’en fin de bulle, trop de sortes, trois ou plus, ou à chaque message',
  form_rule:
    'une bulle hors de sa forme (majuscule, point final, espace avant « ? » ou « ! »), corrigée avant l’envoi',
  close_only_word: 'un mot qu’elle garde pour ses fans proches, écrit à un fan qui ne l’est pas encore',
  language_not_covered: 'une langue que les gardes ne lisent pas, ou qu’elle ne parle pas',
  help_number_from_model: 'un numéro ou une ligne d’aide écrit par l’IA, que seul le code pose',
  refund_unasked: 'un remboursement évoqué alors que le fan n’en demande pas',
  refund_promise: 'un remboursement promis ou décidé par elle (« je te rembourse »), qui se demande à Reveal',
};
