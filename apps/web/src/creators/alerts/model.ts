import {
  CREATOR_ALERT_CODES,
  CREATOR_ALERT_FAMILIES,
  CREATOR_ALERT_FAMILY,
  CREATOR_ALERT_ROLES,
  type CreatorAlertCode,
  type CreatorAlertFamily,
  type CreatorAlertLine,
  type CreatorAlertMode,
  type CreatorAlertRole,
  type CreatorAlertRouting,
} from '@impera/contracts';

/** What each alert is, in the words of the tab (ADR 0150 § B): a title and one sentence. */
export const ALERT_TEXT: Readonly<
  Record<CreatorAlertCode, { readonly title: string; readonly sentence: string }>
> = {
  safety_handoff: {
    title: 'Relais de sécurité',
    sentence: 'Mineur possible, non-consentement, détresse, rencontre ou manipulation : l’IA passe la main.',
  },
  identity_doubt: {
    title: 'Doute sur son identité',
    sentence: 'Le fan doute que ce soit vraiment elle.',
  },
  sale: { title: 'Vente', sentence: 'Un achat lu dans le registre de la plateforme.' },
  offer_proposed: {
    title: 'Offre proposée',
    sentence: 'Quelque chose qui se vend hors des scripts, proposé par l’IA ou demandé par le fan.',
  },
  script_price: {
    title: 'Prix d’un script changé',
    sentence: 'Le prix d’une étape sur la plateforme n’est plus celui décidé : l’étape ne part pas.',
  },
  scripts_exhausted: {
    title: 'Plus de script pour ce fan',
    sentence: 'L’IA ouvrirait un script et aucun ne reste pour lui.',
  },
  her_alerts: {
    title: 'Ses alertes et ses mots',
    sentence: 'Un mot de sa persona ou une de ses alertes personnalisées.',
  },
  ai_budget: {
    title: 'Budget IA',
    sentence: 'Seuil, plafond atteint ou crédits bas : une fois par jour pour toute l’agence.',
  },
  session_expired: {
    title: 'Session expirée',
    sentence: 'La connexion à la plateforme a expiré : l’IA ne lit plus rien.',
  },
  uncovered_account: {
    title: 'Compte sans personne',
    sentence:
      'Un créneau commence sans chatteur et l’IA n’est pas en Automatique, alors que des fans ont écrit dans les 24\u00a0h.',
  },
  shift_not_taken: {
    title: 'Shift non pris',
    sentence:
      'Un shift a commencé et son chatteur n’a pas pris son poste, passé le délai réglé dans Réglages › Alertes.',
  },
};

export const FAMILY_TITLES: Readonly<Record<CreatorAlertFamily, string>> = {
  safety: 'Sécurité',
  sales: 'Ventes',
  conversation: 'Conversation',
  steering: 'Pilotage',
  system: 'Système',
};

export const ROLE_LABELS: Readonly<Record<CreatorAlertRole, string>> = {
  owner: 'Propriétaire',
  manager: 'Manager',
  chatter_on_shift: 'Chatteur en shift',
};

export const MODE_LABELS: Readonly<Record<CreatorAlertMode, string>> = {
  deliver: 'Reçoit',
  muted: 'Sourdine',
  off: 'Rien',
};

/** What each mode does, said once in the legend and in each button's bubble. */
export const MODE_SENTENCES: Readonly<Record<CreatorAlertMode, string>> = {
  deliver: 'notification avec son',
  muted: 'notification sans son ni vibration',
  off: 'aucune notification, l’historique la garde',
};

export interface FamilyGroup {
  readonly family: CreatorAlertFamily;
  readonly lines: readonly CreatorAlertLine[];
}

/** Her lines by family, in the order of the contract; a family with no line is left out. */
export function byFamily(lines: readonly CreatorAlertLine[]): readonly FamilyGroup[] {
  const order = new Map(CREATOR_ALERT_CODES.map((code, index) => [code, index]));
  const sorted = [...lines].sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0));
  return CREATOR_ALERT_FAMILIES.map((family) => ({
    family,
    lines: sorted.filter((line) => CREATOR_ALERT_FAMILY[line.code] === family),
  })).filter((group) => group.lines.length > 0);
}

/** Every role on « Rien »: the alert reaches nobody, said in amber on its line. */
export const reachesNobody = (routes: CreatorAlertRouting): boolean =>
  CREATOR_ALERT_ROLES.every((role) => routes[role] === 'off');

/** The routing with one role changed. */
export const withMode = (
  routes: CreatorAlertRouting,
  role: CreatorAlertRole,
  mode: CreatorAlertMode,
): CreatorAlertRouting => ({ ...routes, [role]: mode });
