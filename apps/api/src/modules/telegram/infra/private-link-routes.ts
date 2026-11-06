import {
  TELEGRAM_LINK_NO_BOT_UNPROCESSABLE,
  DomainError,
  TelegramLinkCodeSchema,
  TelegramPrivateLinkSchema,
  type TelegramLinkCode,
  type TelegramPrivateLink,
} from '@impera/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/** What the routes need of the module (index.ts). */
export interface PrivateLinkApi {
  issueCode(userId: string): Promise<TelegramLinkCode | null>;
  linkOf(userId: string): Promise<TelegramPrivateLink>;
  unlink(userId: string): Promise<void>;
}

export interface PrivateLinkRoutesOptions {
  /** The agency's accounts (owner and team); a creator keeps her own space's way back (ADR 0068 § 5). */
  readonly guard: preValidationAsyncHookHandler;
  /** ADR 0068 § 4: a code or an unlink needs a sign-in under 10 minutes. */
  readonly recentLogin: preValidationAsyncHookHandler;
}

class LinkNoBotUnprocessable extends DomainError {
  constructor() {
    super(
      TELEGRAM_LINK_NO_BOT_UNPROCESSABLE,
      'Aucun bot Telegram n’est branché : il faut d’abord l’ajouter dans Réglages › Telegram',
    );
  }
}

/** A person asks a code by hand: ten a minute is far above that, and a code is not guessed from the CRM side. */
const codeLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

function signedIn(user: { readonly id: string } | null | undefined): string {
  if (user == null) throw new Error('telegram link route reached without a session');
  return user.id;
}

/** `/v1/auth/telegram-link` (SEC-05 lot 2): the signed-in account's own link, nobody else's. No answer carries a chat id. */
export function createPrivateLinkRoutes(
  api: PrivateLinkApi,
  options: PrivateLinkRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    app.addHook('preValidation', options.guard);

    app.get('/auth/telegram-link', { schema: { response: { 200: TelegramPrivateLinkSchema } } }, (request) =>
      api.linkOf(signedIn(request.user)),
    );

    app.post(
      '/auth/telegram-link/code',
      {
        preValidation: options.recentLogin,
        config: codeLimit,
        schema: { response: { 200: TelegramLinkCodeSchema } },
      },
      async (request) => {
        const code = await api.issueCode(signedIn(request.user));
        if (code === null) throw new LinkNoBotUnprocessable();
        return code;
      },
    );

    app.delete(
      '/auth/telegram-link',
      { preValidation: options.recentLogin, schema: { response: { 200: TelegramPrivateLinkSchema } } },
      async (request) => {
        const userId = signedIn(request.user);
        await api.unlink(userId);
        return api.linkOf(userId);
      },
    );

    return Promise.resolve();
  };
}
