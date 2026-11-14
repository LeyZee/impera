import type { ConnectorCapabilities, ExternalRef, Money, SendResult } from '@impera/contracts';

import { SendRefused, type OutboundSender } from '../../conversations';
import { ConnectorFailed, ConnectorUnavailable, PlatformAccountNotFound } from '../domain/errors';
import {
  ConnectorError,
  ScriptStepAlreadySent,
  ScriptStepPriceChanged,
  type PlatformConnector,
} from '../domain/platform-connector';
import type { AccountStore, Clock } from '../domain/ports';

import type { ConnectorResolver } from './resolver';

type ConversationKey = Parameters<OutboundSender['sendText']>[0];

/**
 * The writes of ADR 0018 beside the sends of `OutboundSender`, through the same guarded entry point (`run`, writes:
 * true). Each is called only when the connector declares it (`capable`).
 */
export interface ConnectorWrites {
  /**
   * `scripts`: one step of a platform script, priced by the platform; a step already sent, or whose price the platform
   * no longer lists as `expectedPrice` (the one validated), is `SendRefused`.
   */
  sendScriptStep(
    conversation: ConversationKey,
    scriptRef: ExternalRef,
    stepIndex: number,
    expectedPrice: Money,
    idempotencyKey: string,
  ): Promise<SendResult>;
  /** `fanNoteWrite`: the agency's block of the fan's client note (`platformFanId`: the fan as the platform names him). */
  setFanNote(
    conversation: ConversationKey,
    platformFanId: string,
    text: string,
    idempotencyKey: string,
  ): Promise<void>;
  /** `markRead`. */
  markRead(conversation: ConversationKey): Promise<void>;
  /** `typing`. */
  setTyping(conversation: ConversationKey, on: boolean): Promise<void>;
}

/**
 * The one check of a declared capability (ADR 0018 § 4): the flag, never the method's existence alone. A connector
 * that does not declare it, or lacks the method, is `ConnectorUnavailable`.
 */
function capable<T>(
  connector: PlatformConnector,
  flag: keyof ConnectorCapabilities,
  call: (declared: PlatformConnector) => Promise<T> | undefined,
): Promise<T> {
  if (!connector.capabilities[flag]) throw new ConnectorUnavailable();
  const result = call(connector);
  if (result === undefined) throw new ConnectorUnavailable();
  return result;
}

/**
 * The `OutboundSender` port of `conversations` (modules.md, inversion), and the other writes of ADR 0018: resolves the
 * conversation's account and connector, and turns a `ConnectorError` into a `DomainError` (`connector_rate_limited`…)
 * the send job records. An expired session also stops the account, as a poll would. Every write goes through the
 * account's write guard (`config.writes`, off by default) before the connector is even built; reading what was sent
 * does not. A script step the platform already lists as sent is refused for good (`SendRefused`, ADR 0018 § 5), and
 * so is one whose price changed on the platform since it was validated (`script_price_changed`).
 */
export function createOutboundSender(deps: {
  readonly accounts: Pick<AccountStore, 'get' | 'setSessionState'>;
  readonly resolver: ConnectorResolver;
  readonly clock: Clock;
}): OutboundSender & ConnectorWrites {
  async function run<T>(
    conversation: ConversationKey,
    action: (connector: PlatformConnector, ref: ExternalRef) => Promise<T>,
    writes: boolean,
  ): Promise<T> {
    const account = await deps.accounts.get(conversation.creatorId, conversation.platformAccountId);
    if (account === null) throw new PlatformAccountNotFound();
    if (writes && !account.config.writes) {
      throw new SendRefused('connector_writes_disabled', 'Envoi désactivé pour ce compte (garde d’écriture)');
    }
    const connector = await deps.resolver.forAccount(account);
    if (connector === null) throw new ConnectorUnavailable();
    try {
      return await action(connector, { platform: account.platform, id: conversation.platformConversationId });
    } catch (error) {
      if (error instanceof ScriptStepAlreadySent) {
        throw new SendRefused(
          'script_step_already_sent',
          'Étape déjà envoyée à ce fan (historique de la plateforme)',
        );
      }
      if (error instanceof ScriptStepPriceChanged) {
        throw new SendRefused(
          'script_price_changed',
          'Le prix de l’étape a changé sur la plateforme depuis sa validation',
        );
      }
      if (!(error instanceof ConnectorError)) throw error;
      if (error.code === 'session_expired') {
        await deps.accounts.setSessionState(account.creatorId, account.id, 'expired', {
          correlationId: `send:${conversation.id}`,
          at: deps.clock.now(),
        });
      }
      throw new ConnectorFailed(error.code, { cause: error });
    }
  }

  return {
    sendText: (conversation, text, key) => run(conversation, (c, ref) => c.sendText(ref, text, key), true),
    sendMedia: (conversation, media, key) =>
      run(conversation, (c, ref) => c.sendMedia(ref, media, key), true),
    verifySent: (conversation, key) => run(conversation, (c, ref) => c.verifySent(ref, key), false),
    sendScriptStep: (conversation, scriptRef, stepIndex, expectedPrice, key) =>
      run(
        conversation,
        (c, ref) =>
          capable(c, 'scripts', (d) => d.sendScriptStep?.(ref, scriptRef, stepIndex, expectedPrice, key)),
        true,
      ),
    setFanNote: (conversation, platformFanId, text, key) =>
      run(
        conversation,
        (c, ref) =>
          capable(c, 'fanNoteWrite', (d) =>
            d.setFanNote?.({ platform: ref.platform, id: platformFanId }, text, key),
          ),
        true,
      ),
    markRead: (conversation) =>
      run(conversation, (c, ref) => capable(c, 'markRead', (d) => d.markRead?.(ref)), true),
    setTyping: (conversation, on) =>
      run(conversation, (c, ref) => capable(c, 'typing', (d) => d.setTyping?.(ref, on)), true),
  };
}
