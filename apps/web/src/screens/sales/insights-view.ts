import type { AgeBand, FanPlace, FanSituation, JobFamily, OTHER_CASE, SpendingTier } from '@impera/contracts';

/*
 * « Qui sont tes fans » (CR-15, ADR 0065, ADR 0074): the words and the geometry of the panel. The server has ranked
 * every case and sends shares only; nothing here counts a fan.
 */

type Other = typeof OTHER_CASE;

export const AGE_LABELS: Readonly<Record<AgeBand | Other, string>> = {
  '18_24': '18–24 ans',
  '25_34': '25–34 ans',
  '35_44': '35–44 ans',
  '45_54': '45–54 ans',
  '55_plus': '55 ans et plus',
  other: 'Autres âges',
};

export const PLACE_LABELS: Readonly<Record<FanPlace | Other, string>> = {
  auvergne_rhone_alpes: 'Auvergne-Rhône-Alpes',
  bourgogne_franche_comte: 'Bourgogne-Franche-Comté',
  bretagne: 'Bretagne',
  centre_val_de_loire: 'Centre-Val de Loire',
  corse: 'Corse',
  grand_est: 'Grand Est',
  hauts_de_france: 'Hauts-de-France',
  ile_de_france: 'Île-de-France',
  normandie: 'Normandie',
  nouvelle_aquitaine: 'Nouvelle-Aquitaine',
  occitanie: 'Occitanie',
  pays_de_la_loire: 'Pays de la Loire',
  provence_alpes_cote_d_azur: 'Provence-Alpes-Côte d’Azur',
  outre_mer: 'Outre-mer',
  belgium: 'Belgique',
  switzerland: 'Suisse',
  luxembourg: 'Luxembourg',
  monaco: 'Monaco',
  canada: 'Canada',
  morocco: 'Maroc',
  algeria: 'Algérie',
  tunisia: 'Tunisie',
  senegal: 'Sénégal',
  ivory_coast: 'Côte d’Ivoire',
  spain: 'Espagne',
  italy: 'Italie',
  germany: 'Allemagne',
  portugal: 'Portugal',
  netherlands: 'Pays-Bas',
  united_kingdom: 'Royaume-Uni',
  united_states: 'États-Unis',
  other: 'Ailleurs',
};

export const JOB_LABELS: Readonly<Record<JobFamily | Other, string>> = {
  health: 'Santé et soin',
  teaching: 'Enseignement et recherche',
  engineering: 'Informatique et ingénierie',
  sales: 'Commerce et vente',
  office: 'Bureau, finance et droit',
  building: 'Bâtiment, artisanat et industrie',
  transport: 'Transport et logistique',
  hospitality: 'Hôtellerie et restauration',
  security: 'Sécurité, armée et fonction publique',
  agriculture: 'Agriculture et environnement',
  arts: 'Arts, médias et sport',
  self_employed: 'À son compte',
  student: 'Étudiant',
  retired: 'Retraité',
  other: 'Autres métiers',
};

export const SITUATION_LABELS: Readonly<Record<FanSituation | Other, string>> = {
  single: 'Célibataire',
  couple: 'En couple',
  married: 'Marié',
  separated: 'Séparé ou divorcé',
  other: 'Autre situation',
};

export const TIER_LABELS: Readonly<Record<SpendingTier | Other, string>> = {
  none: 'Rien débloqué',
  under_20: 'Moins de 20 €',
  '20_100': 'De 20 à 100 €',
  '100_500': 'De 100 à 500 €',
  over_500: 'Plus de 500 €',
  other: 'Autres',
};

export const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const;
export const DAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;

/** « 21h–0h » for the slot of three hours that starts at 21h. */
export function slotLabel(slot: number): string {
  const from = slot * 3;
  return `${String(from)}h–${String((from + 3) % 24)}h`;
}

/**
 * The colour of each case, in its order: violet, gold, cyan, pale ink and a blue between violet and cyan. Never the
 * neon nor amber: in Impera red says an emergency and amber a warning, and a share of her fans is neither. « Autres »
 * is always the faint ink, so it never looks like a case of its own.
 */
const PALETTE = [
  'var(--nv-agent)',
  'var(--nv-sale)',
  'var(--nv-success)',
  'var(--nv-data-1)',
  'color-mix(in srgb, var(--nv-agent) 50%, var(--nv-success))',
] as const;

export function caseColour(key: string, index: number): string {
  if (key === 'other') return 'var(--nv-ink-faint)';
  return PALETTE[index % PALETTE.length] ?? 'var(--nv-agent)';
}

/** « environ 40 de tes fans l'ont dit », and « moins de 10 » never shows (the block is `too_few`). */
export function aboutLine(aboutFans: number): string {
  return `Environ ${String(aboutFans)} de tes fans l’ont dit`;
}

export interface Arc {
  /** `stroke-dasharray` of the arc on a circle of radius `radius`. */
  readonly dash: string;
  /** `stroke-dashoffset`: where it starts, clockwise from the top once the ring is turned by −90°. */
  readonly offset: number;
}

/** One arc per share, with a small gap between two arcs; a share of 100 is a full ring. */
export function arcsOf(shares: readonly number[], radius: number, gap = 2.5): Arc[] {
  const circumference = 2 * Math.PI * radius;
  const round = (n: number) => Math.round(n * 100) / 100;
  const shown = shares.filter((s) => s > 0).length;
  let start = 0;
  return shares.map((share) => {
    const length = (share / 100) * circumference;
    const visible = shown > 1 ? Math.max(0, length - gap) : length;
    const arc = {
      dash: `${String(round(visible))} ${String(round(circumference - visible))}`,
      offset: start === 0 ? 0 : round(-start),
    };
    start += length;
    return arc;
  });
}

/** How strong a cell of « Quand ils écrivent » is, from 0 to 1 against the busiest one. */
export function heatOf(share: number, busiest: number): number {
  if (busiest <= 0) return 0;
  return Math.round((share / busiest) * 100) / 100;
}
