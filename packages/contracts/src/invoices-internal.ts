import { z } from 'zod';

/**
 * Helpers the invoices' files share (EQ-06): not re-exported by `invoices.ts`, so not part of the contracts' API.
 */

export const trimmed = (max: number): z.ZodString => z.string().trim().min(1).max(max);

export const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
