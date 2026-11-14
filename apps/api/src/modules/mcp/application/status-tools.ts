import { McpAiUsageSchema, type McpAiUsage } from '@impera/contracts';
import { z } from 'zod';

import type { AiUsageReader } from '../domain/ports';

import type { ServedTool } from './dispatch';

/**
 * The agency's own figures (ADR 0105 § 4): `ai_usage_get`, the owner's alone on an access of the agency (the catalogue's
 * `ownerOnly`), read through `ai-usage`. Each field copied one by one: never a provider's balance, a credit nor a key.
 */
export function statusTools(usage: AiUsageReader): Readonly<Record<string, ServedTool>> {
  return {
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
