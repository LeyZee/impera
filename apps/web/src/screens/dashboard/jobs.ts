import type { StuckJob } from '@impera/contracts';

import type { StuckKind } from './model';

/*
 * The worker's task names in the trade's words (recette 05/11, PRO-10): « 1 tâche bloquée » said what was stuck nowhere.
 * A task named here gets its own sentence; any other is named by its part of Impera, the server's name kept in the
 * title for whoever reads the server's log.
 */

interface Words {
  readonly name: string;
  readonly effect: string;
}

const UNTIL_LOOKED_AT = 'Elle ne reprendra pas seule : signale-la à qui gère le serveur.';

const TASKS: Readonly<Record<string, Words>> = {
  'payroll.fetch_exchange_rates': {
    name: 'Taux de change du jour',
    effect: 'La paie compte les ventes en dollars au dernier taux connu.',
  },
  'payroll.issue_invoices': {
    name: 'Factures des membres',
    effect: 'Les factures de la quinzaine ne sont pas émises.',
  },
  'backups.check': {
    name: 'Contrôle des sauvegardes',
    effect: 'Une sauvegarde manquée ne serait pas signalée.',
  },
  'connector.poll': {
    name: 'Lecture de Reveal',
    effect: 'Les nouveaux messages des fans n’arrivent plus à l’agent.',
  },
  'connector.dispatch': {
    name: 'Lecture de Reveal',
    effect: 'Les nouveaux messages des fans n’arrivent plus à l’agent.',
  },
  'conversation.send': {
    name: 'Envoi d’un message',
    effect: 'Un message de l’agent n’est pas parti.',
  },
  'conversation.respond': {
    name: 'Réponse de l’agent',
    effect: 'Un fan attend une réponse que l’agent n’écrit pas.',
  },
};

/** By the part of Impera a task belongs to, the prefix of its name. */
const AREAS: Readonly<Record<string, string>> = {
  payroll: 'Une tâche de la paie',
  connector: 'Une tâche de lecture de Reveal',
  conversation: 'Une tâche des conversations',
  telegram: 'Une tâche des alertes Telegram',
  notifications: 'Une tâche des notifications',
  scheduling: 'Une tâche du planning',
  team: 'Une tâche de l’équipe',
  fans: 'Une tâche des fiches des fans',
  media: 'Une tâche des médias',
  providers: 'Le contrôle des clés IA',
  creator_tasks: 'Une tâche de l’agenda',
  content_drops: 'Une tâche des fichiers reçus',
  backups: 'Une tâche des sauvegardes',
};

export function stuckKindOf(job: StuckJob): StuckKind {
  const words = TASKS[job.task];
  if (words !== undefined) {
    return {
      task: job.task,
      count: job.count,
      name: words.name,
      effect: `${words.effect} ${UNTIL_LOOKED_AT}`,
    };
  }
  const area = AREAS[job.task.split('.')[0] ?? ''];
  return { task: job.task, count: job.count, name: area ?? 'Une tâche de fond', effect: UNTIL_LOOKED_AT };
}
