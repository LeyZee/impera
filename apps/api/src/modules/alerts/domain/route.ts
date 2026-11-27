import {
  CREATOR_ALERT_ROLES,
  isClosedToChatters,
  isCreatorAlertLocked,
  PUSH_TITLE_MAX,
  type CreatorAlertCode,
  type CreatorAlertLine,
  type CreatorAlertMode,
  type CreatorAlertRole,
  type PushMessage,
} from '@impera/contracts';

import type { SaleSaid } from './classify';
import { creatorAlertLines } from './creator-alerts';

/** The weight of each mode: an agency alert takes, for each role, the loudest of her creators' choices. */
const LOUDNESS: Readonly<Record<CreatorAlertMode, number>> = { off: 0, muted: 1, deliver: 2 };

/** The mode of each role for one alert, read through `creatorAlertLines`: a locked alert is « reçoit » whatever a row says. */
export function modesFor(
  code: CreatorAlertCode,
  lines: readonly CreatorAlertLine[],
): Readonly<Record<CreatorAlertRole, CreatorAlertMode>> {
  // The lock holds here too, whatever line was handed over (relecture Sécurité): never read off a row alone.
  if (isCreatorAlertLocked(code))
    return { owner: 'deliver', manager: 'deliver', chatter_on_shift: 'deliver' };
  const line = lines.find((l) => l.code === code) ?? creatorAlertLines([]).find((l) => l.code === code);
  if (line === undefined) throw new Error(`creator alert without a line: ${code}`);
  // Never to a chatter (ADR 0094 § 3), whatever line was handed over: the steering alerts are the agency's.
  return isClosedToChatters(code) ? { ...line.routes, chatter_on_shift: 'off' } : line.routes;
}

/**
 * An alert of the agency, of no creator (the AI budget): for each role, the loudest mode among the creators' tabs, so
 * that it reaches anyone one of them asks for, once (ADR 0150 § 7). With no creator, the defaults of the code.
 */
export function agencyModesFor(
  code: CreatorAlertCode,
  linesByCreator: readonly (readonly CreatorAlertLine[])[],
): Readonly<Record<CreatorAlertRole, CreatorAlertMode>> {
  if (linesByCreator.length === 0) return modesFor(code, []);
  const pick = (role: CreatorAlertRole): CreatorAlertMode =>
    linesByCreator
      .map((lines) => modesFor(code, lines)[role])
      .reduce((loudest, mode) => (LOUDNESS[mode] > LOUDNESS[loudest] ? mode : loudest), 'off');
  return { owner: pick('owner'), manager: pick('manager'), chatter_on_shift: pick('chatter_on_shift') };
}

/** The roles an alert reaches, each with whether it rings or comes silent. `off` reaches nobody. */
export function reachedRoles(
  modes: Readonly<Record<CreatorAlertRole, CreatorAlertMode>>,
): { readonly role: CreatorAlertRole; readonly silent: boolean }[] {
  return CREATOR_ALERT_ROLES.flatMap((role) =>
    modes[role] === 'off' ? [] : [{ role, silent: modes[role] === 'muted' }],
  );
}

/** What the notification says: her name and the alert, never a fan's name nor his words (ADR 0020). */
const TITLES: Readonly<Record<CreatorAlertCode, string>> = {
  safety_handoff: 'Relais urgent',
  identity_doubt: 'Doute sur la personne',
  sale: 'Vente détectée',
  offer_proposed: 'Offre proposée',
  script_price: 'Prix d’un script changé',
  scripts_exhausted: 'Plus de script pour ce fan',
  her_alerts: 'Alerte',
  ai_budget: 'Budget IA',
  session_expired: 'Session Reveal expirée',
  uncovered_account: 'Compte sans personne',
};

const BODIES: Readonly<Record<CreatorAlertCode, string>> = {
  safety_handoff: 'L’IA a passé la main : un humain doit reprendre la conversation.',
  identity_doubt: 'Le fan doute que ce soit elle : à reprendre par le chatteur en shift.',
  sale: 'Une vente vient d’être lue sur la plateforme.',
  offer_proposed: 'Une offre hors des scripts est en cours : à suivre.',
  script_price: 'Le prix d’une étape n’est plus celui décidé : rien ne part avant correction.',
  scripts_exhausted: 'Ce fan est chaud mais n’a plus de script jouable.',
  her_alerts: 'Une de ses alertes s’est déclenchée.',
  ai_budget: 'La dépense IA du jour franchit un seuil.',
  session_expired: 'Reconnecte la session pour que l’IA reprenne.',
  uncovered_account:
    'Un créneau commence sans chatteur et l’IA n’est pas en Automatique : des fans attendent.',
};

const AMOUNT: Readonly<Record<SaleSaid['currency'], Intl.NumberFormat>> = {
  EUR: new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }),
  USD: new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' }),
};

const SOLD_BY: Readonly<Record<SaleSaid['by'], string>> = {
  agent: 'Vendue par l’IA.',
  member: 'Vendue par le chatteur en poste.',
  unknown: 'Lue sur la plateforme, sans vendeur relié.',
};

/** Where the notification opens: the planning for a créneau nobody holds, the conversation otherwise. */
function urlOf(code: CreatorAlertCode, conversationId: string | null): string {
  if (code === 'uncovered_account') return '/equipe/planning';
  return conversationId === null ? '/suivi' : `/suivi?conversation=${conversationId}`;
}

export function alertMessage(
  code: CreatorAlertCode,
  creatorName: string | null,
  conversationId: string | null,
  silent: boolean,
  sale?: SaleSaid,
): PushMessage {
  // A sale says its amount in its title: fifteen « Vente détectée » alike said nothing (recette 27/11, G19).
  const what =
    code === 'sale' && sale !== undefined
      ? `Vente de ${AMOUNT[sale.currency].format(sale.grossMinor / 100)}`
      : TITLES[code];
  return {
    title: (creatorName === null ? what : `${creatorName} · ${what}`).slice(0, PUSH_TITLE_MAX),
    body: code === 'sale' && sale !== undefined ? SOLD_BY[sale.by] : BODIES[code],
    url: urlOf(code, conversationId),
    ...(silent && { silent: true }),
  };
}
