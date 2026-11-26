import type { McpCapability } from '@impera/contracts';

/**
 * What the owner may tick on an agent access (ADR 0026 § 5, ADR 0105 § 4, ADR 0144): the reads the MCP server serves
 * today, never one by default. The gestures (`write:*`, `prepare:team`) have no served tool yet, so they are not
 * offered: a box that opens nothing would lie.
 */
export interface CapabilityChoice {
  readonly capability: McpCapability;
  readonly label: string;
  /** What the agent then reads, in the screen's words. */
  readonly detail: string;
  /** Said when it is ticked: what leaves Impera for the agent's model provider. */
  readonly warning?: string;
}

export const CAPABILITY_CHOICES: readonly CapabilityChoice[] = [
  {
    capability: 'read:status',
    label: 'Chiffres et état',
    detail:
      'Chiffres de l’agence, statistiques Reveal par jour, état de l’agent de chatting, to-do, quinzaine, consommation de l’IA.',
  },
  {
    capability: 'read:sales',
    label: 'Ventes',
    detail: 'Ventes par jour et par créatrice, additionnées : jamais un vendeur ni une part.',
  },
  {
    capability: 'read:team',
    label: 'Équipe',
    detail: 'Planning, qui est en poste, rapports de fin de shift : jamais un taux ni un montant.',
  },
  {
    capability: 'read:payroll',
    label: 'État de la paie',
    detail: 'Où en est la quinzaine, retards et blocages : jamais le montant d’un membre.',
  },
  {
    capability: 'read:conversations',
    label: 'Conversations',
    detail: 'La liste des conversations et leur état, sans le texte des messages.',
  },
  {
    capability: 'read:conversation_content',
    label: 'Messages et brouillons',
    detail: 'Le texte des messages des fans et des brouillons en attente.',
    warning:
      'Les mots des fans partent chez le fournisseur du modèle de cet agent. Écrits par des inconnus, ils peuvent diriger un agent qui agit : à ne donner qu’à un agent qui lit et résume, jamais à un agent qui lance des commandes, envoie un e-mail ou écrit quelque part.',
  },
  {
    capability: 'read:fans',
    label: 'Fiches des fans',
    detail: 'Fiche d’un fan et ses limites : jamais les notes des chatteurs.',
    warning:
      'La fiche d’un fan reprend ses propres mots. Écrits par un inconnu, ils peuvent diriger un agent qui agit : à ne donner qu’à un agent qui lit et résume, jamais à un agent qui lance des commandes, envoie un e-mail ou écrit quelque part.',
  },
  {
    capability: 'read:media',
    label: 'Dépôts et scripts',
    detail: 'Titres, états et nombre de fichiers : jamais un média ni un prix.',
  },
  {
    capability: 'read:script_content',
    label: 'Texte des scripts',
    detail: 'Les mots de chaque étape d’un script.',
    warning: 'La méthode de l’agence part chez le fournisseur du modèle de cet agent.',
  },
];

/** The name of a capability on the screen; one not offered (a gesture of later) shows as its code. */
export function capabilityLabel(capability: McpCapability): string {
  return CAPABILITY_CHOICES.find((choice) => choice.capability === capability)?.label ?? capability;
}

/** How long an access lives, in days: renewing it is making a new one (90 days at most, `MCP_GRANT_MAX_DAYS`). */
export const DURATIONS = [7, 30, 90] as const;
export type Duration = (typeof DURATIONS)[number];

/** The reads in groups, the sensitive ones apart: what the owner scans before he ticks. */
export const CAPABILITY_GROUPS: readonly {
  readonly title: string;
  readonly sensitive?: true;
  readonly capabilities: readonly McpCapability[];
}[] = [
  { title: 'Chiffres', capabilities: ['read:status', 'read:sales', 'read:payroll'] },
  { title: 'Équipe', capabilities: ['read:team'] },
  {
    title: 'Fans et conversations',
    sensitive: true,
    capabilities: ['read:conversations', 'read:conversation_content', 'read:fans'],
  },
  { title: 'Contenu', capabilities: ['read:media', 'read:script_content'] },
];

/** A ready set of reads for a common agent: one tap ticks them, the owner can still change each. */
export interface Preset {
  readonly id: 'accounting' | 'daily' | 'custom';
  readonly title: string;
  readonly detail: string;
  readonly label: string;
  readonly capabilities: readonly McpCapability[];
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'accounting',
    title: 'Comptabilité',
    detail: 'Ventes et coût de l’IA, pour ton logiciel de compta.',
    label: 'Comptabilité',
    capabilities: ['read:sales', 'read:status'],
  },
  {
    id: 'daily',
    title: 'Point du jour',
    detail: 'Chiffres, ventes, équipe et paie, pour Claude sur ton PC.',
    label: 'Claude du PC',
    capabilities: ['read:status', 'read:sales', 'read:team', 'read:payroll'],
  },
  {
    id: 'custom',
    title: 'Sur mesure',
    detail: 'Rien de coché : tu choisis chaque lecture.',
    label: '',
    capabilities: [],
  },
];
