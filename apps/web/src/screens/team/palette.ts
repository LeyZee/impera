/**
 * The members' colours on the planning (CR-12, relecture d'Extension du 02/11) : douze nuances, une seule valeur
 * pour les deux thèmes, chacune lisible à 3:1 au moins sur la surface relevée et sur le fond, en Nuit comme en Jour. Aucune n'est
 * proche du rouge de la marque ni des urgences, de l'ambre des avertissements, ni du violet de l'IA : ces couleurs
 * disent un état, celle d'un membre ne dit que qui il est. Tirées en OKLCH à luminance visée, deux clartés alternées pour que deux
 * voisines se distinguent. Une couleur enregistrée hors de la palette reste celle du membre tant qu'on ne la change
 * pas.
 */
export const MEMBER_PALETTE = [
  { hex: '#7d6b0e', name: 'Olive' },
  { hex: '#7a8201', name: 'Anis' },
  { hex: '#467502', name: 'Vert' },
  { hex: '#058f41', name: 'Émeraude' },
  { hex: '#0a775a', name: 'Menthe' },
  { hex: '#028b81', name: 'Sarcelle' },
  { hex: '#09747c', name: 'Pétrole' },
  { hex: '#0987a6', name: 'Azur' },
  { hex: '#0a6fa3', name: 'Acier' },
  { hex: '#227ae4', name: 'Bleu' },
  { hex: '#ae4ab0', name: 'Orchidée' },
  { hex: '#b33787', name: 'Framboise' },
] as const;

export type MemberShade = (typeof MEMBER_PALETTE)[number];

/** The palette's name of a colour, or null for one saved before the palette (kept as it is). */
export function shadeOf(color: string | null): MemberShade | null {
  if (color === null) return null;
  return MEMBER_PALETTE.find((shade) => shade.hex === color.toLowerCase()) ?? null;
}
