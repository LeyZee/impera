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
  platform_meeting_word: 'Mot de rencontre que la plateforme repère, même dans un refus',
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
