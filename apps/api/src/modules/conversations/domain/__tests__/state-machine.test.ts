import { ConversationStateSchema, DraftStatusSchema } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { canDraftBecome, nextState } from '../state-machine';

describe('conversation state machine', () => {
  it('moves a fan message to pending, except where a human or an error holds the conversation', () => {
    expect(nextState('idle', 'receive_inbound')).toBe('pending');
    expect(nextState('awaiting_approval', 'receive_inbound')).toBe('pending');
    expect(nextState('human', 'receive_inbound')).toBe('human');
    expect(nextState('paused', 'receive_inbound')).toBe('paused');
    expect(nextState('error', 'receive_inbound')).toBe('error');
  });

  it('follows the copilot path: draft, approval, verified send', () => {
    const path = [
      nextState('pending', 'create_draft'),
      nextState('awaiting_approval', 'approve'),
      nextState('sending', 'send_verified'),
    ];
    expect(path).toEqual(['awaiting_approval', 'sending', 'idle']);
  });

  it('drafts a follow-up from idle, never where a human, a pause or an error holds the conversation', () => {
    expect(nextState('idle', 'create_draft')).toBe('awaiting_approval');
    expect(nextState('paused', 'create_draft')).toBeNull();
    expect(nextState('error', 'create_draft')).toBeNull();
    expect(nextState('sending', 'create_draft')).toBeNull();
  });

  it('refuses what the state does not allow', () => {
    expect(nextState('idle', 'approve')).toBeNull();
    expect(nextState('human', 'create_draft')).toBeNull();
    expect(nextState('idle', 'release')).toBeNull();
    expect(nextState('human', 'handoff')).toBeNull();
  });

  it('lets a human take over from anywhere, and release only human or error', () => {
    for (const state of ConversationStateSchema.options) {
      expect(nextState(state, 'takeover')).toBe('human');
      const released = nextState(state, 'release');
      expect(released).toBe(state === 'human' || state === 'error' ? 'idle' : null);
    }
  });

  it('lets the engine hand over from anywhere a takeover could, and stand down only while answering', () => {
    for (const state of ConversationStateSchema.options) {
      expect(nextState(state, 'handoff')).toBe(state === 'human' ? null : 'human');
      const skipped = nextState(state, 'skip_reply');
      expect(skipped).toBe(state === 'pending' || state === 'drafting' ? 'idle' : null);
    }
  });

  it('never leaves a closed draft', () => {
    for (const closed of ['rejected', 'sent', 'failed', 'expired'] as const) {
      for (const to of DraftStatusSchema.options) expect(canDraftBecome(closed, to)).toBe(false);
    }
    expect(canDraftBecome('rejected', 'approved')).toBe(false);
    expect(canDraftBecome('pending', 'edited')).toBe(true);
    expect(canDraftBecome('approved', 'sent')).toBe(true);
  });
});
