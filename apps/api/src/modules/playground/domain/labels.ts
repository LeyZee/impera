/**
 * French labels the training screen shows as is (the screen does not translate codes). One sentence each, in
 * the team's words; an unknown code falls back to itself so a new guard never shows an empty line.
 */
const GUARD_LABELS: Readonly<Record<string, string>> = {
  ai_disclosure: 'Elle dit ou laisse entendre qu’elle est une IA',
  love_declaration: 'Déclaration d’amour, interdite',
  meeting_promise: 'Promesse de rencontre, interdite',
  contact_info: 'Coordonnées ou autre réseau',
  assistant_output: 'Répond comme un assistant, pas comme elle',
  ai_tic: 'Tournure typique d’une IA',
  forbidden_term: 'Mot interdit par sa persona',
  too_many_bubbles: 'Trop de bulles d’un coup',
  bubble_too_long: 'Bulle trop longue',
  stage_direction: 'Didascalie (« *sourit* », « (rires) »), jamais dans ses messages',
  media_not_sent: 'Annonce un média que le brouillon ne porte pas',
  platform_meeting_word: 'Mot de rencontre (garde retirée le 2 novembre, Reveal ne repère aucun mot)',
  fake_emergency: 'Maladie, dette ou urgence pour vendre, interdit',
  repetition: 'Bulle déjà envoyée ou même ouverture une troisième fois',
  closed_question_streak: 'Troisième question fermée de suite',
};

const TRAP_LABELS: Readonly<Record<string, string>> = {
  override: 'Il essaie de lui faire ignorer ses règles',
  role_change: 'Il lui demande de jouer un autre rôle',
  prompt_extraction: 'Il cherche à lire ses instructions',
  system_markup: 'Balises techniques dans son message',
  off_topic_task: 'Il lui demande une tâche hors sujet (recette, code, devoir)',
};

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  fan_message: 'dans son message',
  media: 'dans son média',
  brain: 'repéré par le cerveau',
};

export function guardLabel(code: string): string {
  return GUARD_LABELS[code] ?? code;
}

export function trapLabel(kind: string, source: string): string {
  const where = SOURCE_LABELS[source];
  return `${TRAP_LABELS[kind] ?? kind}${where === undefined ? '' : `, ${where}`}`;
}

/** Why the policy refused the brain's offer (agent/domain/policy.ts `OfferBlock`, and no offer context at all). */
const OFFER_REFUSAL_LABELS: Readonly<Record<string, string>> = {
  do_not_contact: 'Fan à ne plus contacter',
  risk: 'Un risque lu dans son message arrête toute vente',
  sales_frozen: 'Ventes gelées pour ce fan',
  age_unconfirmed: 'Son âge n’est pas confirmé',
  no_budget: 'Il a dit ne pas avoir d’argent',
  cooldown: 'Trop tôt après la dernière offre',
  low_desire: 'Désir sous le seuil du script',
  no_offer_context: 'Sa persona ne fixe aucun rythme de scripts',
};

/** What the cursor decided on going sexual (agent/domain/sexualization.ts `SexualizationDecision`). */
const CURSOR_LABELS: Readonly<Record<string, string>> = {
  free: 'Libre : elle peut le suivre ou ouvrir elle-même',
  suggestive_only: 'Suggestif seulement : un humain a dit rien d’explicite',
  no_opening: 'Elle n’ouvre pas l’intime (trop tôt, désir trop bas ou âge inconnu)',
  'steer_back:age_unconfirmed': 'Elle ralentit : son âge n’est pas confirmé',
  'steer_back:too_early': 'Elle ralentit : trop tôt dans la relation',
};

export function offerRefusalLabel(code: string): string {
  return OFFER_REFUSAL_LABELS[code] ?? code;
}

export function cursorLabel(kind: string, reason?: string): string {
  const code = reason === undefined ? kind : `${kind}:${reason}`;
  return CURSOR_LABELS[code] ?? code;
}
