import type {
  AgentMode,
  CreatorId,
  CreatorSetupStep,
  MemberSetupStep,
  SetupNote,
  SetupState,
  TeamMemberId,
} from '@impera/contracts';

import type { CreatorSheet } from '@/creators/search';
import { notIssuedForOwner, notIssuedPlace } from '@/payroll/model';

/*
 * « Mise en route » as the screen says it: each step's words and where it is done. Whether it is done is the server's
 * (pilotage plan W1); nothing here decides it.
 */

/** Where a step is done: one of her sheets, a page of the CRM, or nowhere to go (done on the sheet itself, or by him). */
export type SetupTarget =
  | { readonly kind: 'sheet'; readonly sheet: CreatorSheet; readonly creatorId: CreatorId }
  | { readonly kind: 'dashboard'; readonly creatorId: CreatorId }
  | { readonly kind: 'file'; readonly memberId: TeamMemberId }
  /** A block of the sheet the card sits on, reached by scrolling to its id. */
  | { readonly kind: 'anchor'; readonly id: string }
  | {
      readonly kind: 'page';
      readonly to:
        | '/reglages/facturation'
        | '/reglages/ventes'
        | '/reglages/regles-de-paie'
        | '/reglages/telegram'
        | '/equipe/planning'
        | '/equipe/reveal'
        | '/aide/extension';
    };

export interface SetupLine {
  readonly key: string;
  readonly state: SetupState;
  readonly label: string;
  /** One sentence: why it matters when it is left, or what stands when it is done. */
  readonly hint: string | null;
  readonly target: SetupTarget | null;
  /** What the step's button says while it is left: « Régler » unless the step asks for another verb. */
  readonly verb: 'Régler' | 'Lancer' | 'Le guide' | 'Nouveau lien';
  /** An avertissement (amber): something that went wrong and waits on the agency, such as a link that died unused. */
  readonly warning: boolean;
}

const MODES: Readonly<Record<AgentMode, string>> = {
  auto: 'Automatique',
  copilot: 'Copilote',
  stop: 'Arrêt',
};

const accounts = (note: SetupNote | null): string | null =>
  note?.kind === 'accounts'
    ? `${String(note.done)} compte${note.done > 1 ? 's' : ''} sur ${String(note.total)}`
    : null;

export function creatorLines(creatorId: CreatorId, steps: readonly CreatorSetupStep[]): SetupLine[] {
  const sheet = (name: CreatorSheet): SetupTarget => ({ kind: 'sheet', sheet: name, creatorId });
  return steps.map(({ key, state, note }): SetupLine => {
    const done = state === 'done';
    const line = (
      label: string,
      hint: string | null,
      target: SetupTarget | null,
      verb: SetupLine['verb'] = 'Régler',
    ): SetupLine => ({ key, state, label, hint, target, verb, warning: false });
    switch (key) {
      case 'platform_account':
        return line(
          'Son compte Reveal relié',
          done ? null : 'Importe-la depuis Réglages › Ventes : ses ventes et ses shifts en dépendent.',
          { kind: 'page', to: '/reglages/ventes' },
        );
      case 'persona':
        return line(
          'Sa persona',
          done ? null : 'Ce que l’agent sait d’elle et sa façon de parler.',
          sheet('persona'),
        );
      case 'agency_rate':
        return line(
          'La part de l’agence',
          note?.kind === 'share_read_on_platform'
            ? 'Lue chez Reveal : le pourcentage est facultatif.'
            : done
              ? null
              : 'Relie son compte Reveal pour la lire, ou règle le pourcentage.',
          sheet('rate'),
        );
      case 'access':
        if (note?.kind === 'invitation_expired') {
          return {
            ...line(
              'Son accès à son espace',
              'Son lien a expiré sans être ouvert.',
              sheet('access'),
              'Nouveau lien',
            ),
            warning: true,
          };
        }
        return line(
          'Son accès à son espace',
          state === 'waiting'
            ? 'Invitation envoyée, pas encore ouverte.'
            : done
              ? null
              : 'À créer : son lien d’invitation.',
          sheet('access'),
        );
      case 'pay_rules':
        return line(
          'Les règles de paie de ses comptes',
          done
            ? accounts(note)
            : [accounts(note), 'Sans elles, les rapports de fin de shift sont refusés.']
                .filter((part) => part !== null)
                .join(' · '),
          { kind: 'page', to: '/reglages/regles-de-paie' },
        );
      case 'telegram':
        return line(
          'Un groupe Telegram pour ses alertes',
          note?.kind === 'telegram_off'
            ? 'Telegram n’est pas branché : personne n’est prévenu la nuit.'
            : done
              ? null
              : 'Aucun groupe ne reçoit ses alertes urgentes : personne n’est prévenu la nuit.',
          { kind: 'page', to: '/reglages/telegram' },
        );
      case 'agent_hours':
        return line(
          'Les heures d’activité de l’agent',
          note?.kind === 'default_hours' ? 'Heures par défaut de l’agence.' : null,
          sheet('hours'),
        );
      case 'shifts':
        return line(
          'Ses shifts au planning',
          done ? null : 'Aucun shift sur ses comptes, ni prévu ni ces 14 derniers jours.',
          { kind: 'page', to: '/equipe/planning' },
        );
      case 'agent_mode':
        return line(
          'Le mode de l’agent',
          note?.kind === 'agent_mode'
            ? done
              ? MODES[note.mode]
              : 'Arrêt : l’agent ne prépare rien pour elle.'
            : null,
          { kind: 'dashboard', creatorId },
        );
      case 'reliability_check':
        return line(
          'La vérification de fiabilité',
          note?.kind === 'check_not_clean'
            ? 'La dernière vérification n’est pas propre.'
            : done
              ? null
              : 'À lancer sur une quinzaine finie où son compte était relié.',
          { kind: 'page', to: '/reglages/ventes' },
          'Lancer',
        );
    }
  });
}

export function memberLines(memberId: TeamMemberId, steps: readonly MemberSetupStep[]): SetupLine[] {
  return steps.map(({ key, state, note }): SetupLine => {
    const done = state === 'done';
    const line = (
      label: string,
      hint: string | null,
      target: SetupTarget | null,
      verb: SetupLine['verb'] = 'Régler',
    ): SetupLine => ({ key, state, label, hint, target, verb, warning: false });
    switch (key) {
      case 'invitation':
        if (note?.kind === 'invitation_expired') {
          return {
            ...line(
              'Son invitation',
              'Son lien a expiré sans être ouvert.',
              { kind: 'anchor', id: memberAccessId(memberId) },
              'Nouveau lien',
            ),
            warning: true,
          };
        }
        return line(
          'Son invitation',
          done ? null : 'Son lien n’est pas encore ouvert : il se gère plus bas, avec son accès.',
          null,
        );
      case 'second_factor':
        return line(
          'Sa double authentification',
          done ? null : 'À activer de son côté, dans Moi › Sécurité.',
          null,
        );
      case 'extension':
        return line(
          'Son extension',
          done ? null : 'À relier depuis son navigateur, en suivant le guide.',
          { kind: 'page', to: '/aide/extension' },
          'Le guide',
        );
      case 'platform_account':
        return line(
          'Son compte Reveal',
          done ? null : 'Ses ventes ne lui sont attribuées qu’une fois son compte chatteur relié.',
          { kind: 'page', to: '/equipe/reveal' },
        );
      case 'creators':
        return line('Ses créatrices', done ? null : 'À choisir avec « Modifier ».', null);
      case 'first_shift':
        return line('Son premier shift', done ? null : 'À poser au planning.', {
          kind: 'page',
          to: '/equipe/planning',
        });
      case 'billing': {
        // Only the owner reads this step: the server leaves it out of a manager's list.
        const reason = note?.kind === 'billing' ? note.reason : null;
        const place = notIssuedPlace(reason);
        return line(
          'Sa facturation',
          reason === null
            ? null
            : // Under a tax treaty the invoice goes out: it is the transfer that waits (ADR 0041).
              reason === 'tax_residence_missing' || reason === 'tax_residence_unverified'
              ? `Son premier versement serait bloqué : ${notIssuedForOwner(reason)}.`
              : `Sa première facture ne partirait pas : ${notIssuedForOwner(reason)}.`,
          place === 'billing'
            ? { kind: 'page', to: '/reglages/facturation' }
            : place === 'file'
              ? { kind: 'file', memberId }
              : null,
        );
      }
    }
  });
}

/** The id of the « Accès » block of a member's sheet, where his link is made. */
export const memberAccessId = (memberId: TeamMemberId): string => `acces-${memberId}`;

/** « 7 sur 10 » : what is done, never what is left. */
export const progressOf = (lines: readonly SetupLine[]): { done: number; total: number } => ({
  done: lines.filter((line) => line.state === 'done').length,
  total: lines.length,
});

/**
 * The step to do first: an avertissement (a link that died unused), then one to do, then one that waits on someone
 * else; none once all are done.
 */
export const nextOf = (lines: readonly SetupLine[]): SetupLine | undefined =>
  lines.find((line) => line.warning) ??
  lines.find((line) => line.state === 'todo') ??
  lines.find((line) => line.state === 'waiting');
