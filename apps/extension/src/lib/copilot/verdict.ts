import {
  CopilotVerdictBodySchema,
  CopilotVerdictResultSchema,
  DraftIdSchema,
  ExtensionLinkTokenSchema,
  type CopilotVerdictBody,
} from '@impera/contracts';
import { z } from 'zod';

import type { Fetch } from '../session';

/**
 * The chatter's gesture on a draft (ADR 0086 § 4 and § 8), sent by the service worker with the person's link, never
 * the CRM's cookie. A gesture sent twice creates nothing on the server (one gesture per draft).
 */

const TIMEOUT_MS = 8_000;

/** Panel → service worker: the panel never reads the link. */
export const FromPanelSchema = z.strictObject({
  type: z.literal('panel/verdict'),
  draftId: DraftIdSchema,
  body: CopilotVerdictBodySchema,
});
export type FromPanel = z.infer<typeof FromPanelSchema>;

/**
 * - `sent`: recorded (or already recorded);
 * - `unlinked`: no link in this browser, or it was removed in the CRM: « Relier l'extension » in the popup;
 * - `refused`: the draft is gone or no longer his (moved on, decided elsewhere);
 * - `unreachable`: no answer, the panel says it and the text stays placed.
 */
export type VerdictSent = 'sent' | 'unlinked' | 'refused' | 'unreachable';
export const VerdictSentSchema = z.enum(['sent', 'unlinked', 'refused', 'unreachable']);

export async function sendVerdict(
  origin: string,
  token: string | null,
  draftId: string,
  body: CopilotVerdictBody,
  fetchFn: Fetch = fetch,
): Promise<VerdictSent> {
  const link = ExtensionLinkTokenSchema.safeParse(token);
  if (!link.success) return 'unlinked';
  let response: Response;
  try {
    response = await fetchFn(`${origin}/v1/copilot/drafts/${encodeURIComponent(draftId)}/verdict`, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-extension-link': link.data,
      },
      body: JSON.stringify(CopilotVerdictBodySchema.parse(body)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return 'unreachable';
  }
  if (response.status === 401) return 'unlinked';
  if (response.status >= 500 || response.status === 429 || response.status === 408) return 'unreachable';
  if (!response.ok) return 'refused';
  return CopilotVerdictResultSchema.safeParse(await response.json().catch(() => null)).success
    ? 'sent'
    : 'unreachable';
}
