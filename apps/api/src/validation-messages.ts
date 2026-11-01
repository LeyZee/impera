import { z } from 'zod';

/**
 * Zod's own messages in French, process-wide (api.md § Erreurs: `message` and the field errors of `details.fields`
 * are read by the operator). A message a schema writes itself (`refine`, `{ error }`) still wins over these.
 * Idempotent: the API and the worker both call it at startup.
 */
export function useFrenchValidationMessages(): void {
  z.config(z.locales.fr());
}
