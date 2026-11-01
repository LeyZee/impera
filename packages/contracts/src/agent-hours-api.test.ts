import { describe, expect, it } from 'vitest';

import {
  AgentHoursViewSchema,
  DEFAULT_AGENT_HOURS,
  SetAgentHoursBodySchema,
  SUGGESTED_REPLY_SLOTS,
} from './agent-hours';
import { reopenJobKey } from './jobs';

describe('her hours over HTTP (P3-14)', () => {
  it('sends her hours with her zone, and says when they are the defaults', () => {
    const view = {
      hours: DEFAULT_AGENT_HOURS,
      isDefault: true,
      invalidStored: false,
      timeZone: 'Europe/Paris',
    };
    expect(AgentHoursViewSchema.parse(view)).toEqual(view);
    expect(AgentHoursViewSchema.safeParse({ ...view, timeZone: '' }).success).toBe(false);
  });

  it('takes her hours, or null to go back to the defaults, and nothing half set', () => {
    const slots = { ...DEFAULT_AGENT_HOURS, reply: { mode: 'slots', slots: [...SUGGESTED_REPLY_SLOTS] } };
    expect(SetAgentHoursBodySchema.parse({ hours: slots })).toEqual({ hours: slots });
    expect(SetAgentHoursBodySchema.parse({ hours: null })).toEqual({ hours: null });
    expect(SetAgentHoursBodySchema.safeParse({}).success).toBe(false);
    expect(SetAgentHoursBodySchema.safeParse({ hours: { reply: { mode: 'always' } } }).success).toBe(false);
  });

  it('keys one opening job per creator', () => {
    expect(reopenJobKey('c1')).toBe('conversation.reopen:c1');
    expect(reopenJobKey('c1')).not.toBe(reopenJobKey('c2'));
  });
});
