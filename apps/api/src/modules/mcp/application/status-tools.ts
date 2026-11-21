import {
  CreatorIdSchema,
  McpAiUsageSchema,
  McpStatsInputSchema,
  McpStatsSchema,
  UserIdSchema,
  type AgencyFigures,
  type McpAiUsage,
  type McpStats,
} from '@impera/contracts';
import { z } from 'zod';

import { McpReadRefused } from '../domain/errors';
import type { AiUsageReader, StatsReader } from '../domain/ports';

import type { ServedTool } from './dispatch';

/** A period's figures without the shares nor the VAT on the agency's transfers (ADR 0105 § 3), copied one by one. */
function figuresOf(figures: AgencyFigures): McpStats['totals']['current'] {
  return {
    revenueMinor: figures.revenueMinor,
    revenueExclVatMinor: figures.revenueExclVatMinor,
    netMinor: figures.netMinor,
    sales: figures.sales,
    refunds: figures.refunds,
  };
}

type Breakdown = Pick<McpStats['days'][number], 'revenueMinor' | 'byCreator' | 'byKind'>;

function breakdownOf(one: Breakdown): Breakdown {
  return {
    revenueMinor: one.revenueMinor,
    byCreator: one.byCreator.map((c) => ({ creatorId: c.creatorId, revenueMinor: c.revenueMinor })),
    byKind: one.byKind.map((k) => ({ kind: k.kind, revenueMinor: k.revenueMinor })),
  };
}

type SubscriberFigures = NonNullable<McpStats['subscribers']>['current'];

function subscriberFiguresOf(one: SubscriberFigures): SubscriberFigures {
  return {
    activeAtEnd: one.activeAtEnd,
    activeBefore: one.activeBefore,
    newSubscribers: one.newSubscribers,
    unsubscribes: one.unsubscribes,
    renewals: one.renewals,
    ppvSent: one.ppvSent,
    ppvPurchased: one.ppvPurchased,
    messagesSent: one.messagesSent,
    messagesReceived: one.messagesReceived,
    daysRead: one.daysRead,
    days: one.days,
  };
}

/**
 * The agency's own figures, on an access of the agency. `stats_get` (ADR 0026 § 5, ADR 0078), read through
 * `supervision` by the rule of the Dashboard's « Agence »: never a share nor a seller (Charles's decision A, 14/11).
 * `ai_usage_get` (ADR 0105 § 4), the owner's alone (the catalogue's `ownerOnly`), read through `ai-usage`: never a
 * provider's balance, a credit nor a key. Each field copied one by one.
 */
export function statusTools(usage: AiUsageReader, stats: StatsReader): Readonly<Record<string, ServedTool>> {
  return {
    stats_get: {
      description:
        'Les chiffres de l’agence comme l’écran Agence du Dashboard, sur une période qui finit aujourd’hui (`day`, `week`, `month`, `quarter` : 1, 7, 30 ou 90 jours) et sur la période d’avant de même longueur : chiffre d’affaires TTC, HT et net, ventes et remboursements ; par jour, par créatrice et par type de vente ; les ventes par jour de la semaine et par heure ; les fans payants (nombre, nouveaux, part des dix premiers, moyenne) ; abonnés, PPV et messages relevés chez la plateforme. En centimes d’euro, les dollars au dernier taux de la paie. Pour le propriétaire et un manager actif (ses créatrices seulement) ; un accès lié à une créatrice ne lit que ses chiffres à elle. Jamais la part de l’agence ni celle d’une créatrice, jamais qui a vendu, jamais un fan.',
      input: McpStatsInputSchema,
      output: McpStatsSchema,
      run: async ({ grant, actor, creatorId }, input): Promise<McpStats> => {
        const { period } = McpStatsInputSchema.parse(input);
        const read = await stats.agencyInsights(
          {
            userId: UserIdSchema.parse(grant.userId),
            role: actor.role,
            creatorIds:
              actor.readableCreatorIds === 'all'
                ? []
                : actor.readableCreatorIds.map((id) => CreatorIdSchema.parse(id)),
          },
          period,
          // An access bound to a creator reads her figures alone (the catalogue's confinement).
          creatorId === null ? undefined : CreatorIdSchema.parse(creatorId),
        );
        // Not the owner's nor an active manager's (ADR 0078 § 1): the same answer as the screen's refusal.
        if (read === null) throw new McpReadRefused('role_forbidden');
        return {
          period,
          from: read.from,
          to: read.to,
          previousFrom: read.previousFrom,
          previousTo: read.previousTo,
          creators: read.creators.map((c) => ({ creatorId: c.creatorId, name: c.name })),
          totals: { current: figuresOf(read.totals.current), previous: figuresOf(read.totals.previous) },
          days: read.days.map((d) => ({ day: d.day, ...breakdownOf(d) })),
          kinds: read.kinds.map((k) => ({
            kind: k.kind,
            revenueMinor: k.revenueMinor,
            sales: k.sales,
            previousRevenueMinor: k.previousRevenueMinor,
          })),
          byCreator: read.byCreator.map((c) => ({
            creatorId: c.creatorId,
            ...figuresOf(c),
            previousRevenueMinor: c.previousRevenueMinor,
          })),
          hours: read.hours.map((row) => [...row]),
          hourly: read.hourly.map((h) => ({ hour: h.hour, ...breakdownOf(h) })),
          fans: {
            paying: read.fans.paying,
            previousPaying: read.fans.previousPaying,
            newPaying: read.fans.newPaying,
            topTenShare: read.fans.topTenShare,
            averagePerPayingMinor: read.fans.averagePerPayingMinor,
          },
          refundsWithoutSale: read.refundsWithoutSale,
          timeZone: read.timeZone,
          dollarsLeftOut: read.dollarsLeftOut,
          subscribers:
            read.subscribers === null
              ? null
              : {
                  current: subscriberFiguresOf(read.subscribers.current),
                  previous: subscriberFiguresOf(read.subscribers.previous),
                  days: read.subscribers.days.map((d) => ({ day: d.day, active: d.active })),
                  readAt: read.subscribers.readAt,
                },
        };
      },
    },
    ai_usage_get: {
      description:
        'Ce que l’IA coûte à l’agence, comme l’écran Réglages › Consommation IA : aujourd’hui face au plafond du jour, les derniers jours, le rythme du mois, le dernier appel. En euros. Jamais un solde de fournisseur ni une clé.',
      input: z.strictObject({}),
      output: McpAiUsageSchema,
      run: async (): Promise<McpAiUsage> => {
        const read = await usage.read();
        return {
          readAt: read.readAt,
          today: {
            day: read.today.day,
            eur: read.today.eur,
            capEur: read.today.capEur,
            alertAtEur: read.today.alertAtEur,
            state: read.today.state,
            calls: read.today.calls,
            failed: read.today.failed,
          },
          days: read.days.map((day) => ({ day: day.day, eur: day.eur, calls: day.calls })),
          pace: {
            perDayEur: read.pace.perDayEur,
            perDayOver: read.pace.perDayOver,
            monthEur: read.pace.monthEur,
            monthForecastEur: read.pace.monthForecastEur,
            month: read.pace.month,
          },
          lastCallAt: read.lastCallAt,
        };
      },
    },
  };
}
