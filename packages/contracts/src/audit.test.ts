import { describe, expect, it } from 'vitest';

import {
  AuditExportQuerySchema,
  AuditQuerySchema,
  auditCategoryOf,
  auditNameRefs,
  describeAuditEntry,
  type AuditNames,
} from './audit';

const NORA = '0195f0c0-0000-7000-8000-0000000000b1';
const ANNA = '0195f0c0-0000-7000-8000-0000000000c1';
const SHIFT = '0195f0c0-0000-7000-8000-0000000000d1';
const names: AuditNames = { members: new Map([[NORA, 'Nora']]), creators: new Map([[ANNA, 'Anna']]) };

describe('an entry of the journal (EQ-18)', () => {
  it('shows an action nobody has described as written, without its details, never an error', () => {
    expect(
      describeAuditEntry(
        { action: 'view_as.open', entity: 'team_member', entityId: NORA, details: { secret: 's3cr3t' } },
        names,
      ),
    ).toEqual({ category: 'team', label: 'view_as.open', link: { kind: 'member', id: NORA } });
  });

  it('shows the action as written when its details do not parse, whatever they hold', () => {
    for (const details of [null, 'texte', 42, [], { period: '2026-11-03' }, { period: 20261101 }]) {
      expect(
        describeAuditEntry({ action: 'bonus.create', entity: 'bonus', entityId: NORA, details }, names),
      ).toEqual({
        category: 'money',
        label: 'bonus.create',
        link: null,
      });
    }
  });

  it('describes a known action with its names and its link', () => {
    expect(
      describeAuditEntry({ action: 'shift.cancel', entity: 'shift', entityId: SHIFT, details: {} }, names),
    ).toEqual({ category: 'team', label: 'a annulé un shift', link: { kind: 'shift', id: SHIFT } });
    expect(
      describeAuditEntry(
        {
          action: 'team_role.create',
          entity: 'team_member',
          entityId: NORA,
          details: { teamRole: 'manager', effectiveFrom: '2026-12-01' },
        },
        names,
      ),
    ).toEqual({
      category: 'team',
      label: 'a changé le rôle de Nora en manager à partir du 1er décembre 2026',
      link: { kind: 'member', id: NORA },
    });
    expect(
      describeAuditEntry(
        {
          action: 'kill_switch.on',
          entity: 'kill_switch',
          entityId: ANNA,
          details: { scope: 'creator', correlationId: 'c' },
        },
        names,
      ),
    ).toEqual({
      category: 'agent',
      label: 'a arrêté l’agent pour Anna',
      link: { kind: 'creator', id: ANNA },
    });
  });

  it('describes a call of an MCP tool by its family, never by the name an agent gave', () => {
    const call = (action: string, outcome: string) =>
      describeAuditEntry(
        {
          action,
          entity: 'mcp_grant',
          entityId: NORA,
          details: { outcome, creatorId: ANNA, subject: { fanId: NORA } },
        },
        names,
      );
    expect(call('mcp.fan_card', 'ok')).toEqual({
      category: 'access',
      label: 'a appelé l’outil fan_card par MCP pour Anna',
      link: null,
    });
    expect(call('mcp.tool_unknown', 'tool_unknown').label).toBe(
      'a appelé un outil inconnu par MCP pour Anna (refusé)',
    );
  });

  it('files an action nobody has described by its first word, money first', () => {
    expect(auditCategoryOf('invoice.reminded')).toBe('money');
    expect(auditCategoryOf('payroll_settings.reset')).toBe('money');
    expect(auditCategoryOf('auth.something_new')).toBe('access');
    expect(auditCategoryOf('creator.something_new')).toBe('team');
    expect(auditCategoryOf('commission_rate.create')).toBe('money');
    expect(auditCategoryOf('toString')).toBe('team');
  });

  it('lists the ids a page must name: the entity and the members or creators its details name', () => {
    expect(
      auditNameRefs({
        action: 'pay_sale_decision.create',
        entity: 'pay_sale_decision',
        entityId: SHIFT,
        details: { recipientMemberId: NORA, creatorId: ANNA, memberId: 'pas-un-id' },
      }),
    ).toEqual([SHIFT, NORA, ANNA]);
    expect(auditNameRefs({ action: 'x', entity: 'x', entityId: '2026', details: 'texte' })).toEqual([]);
  });
});

describe('the selection of /v1/audit', () => {
  it('reads its filters and bounds its pages', () => {
    expect(AuditQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(AuditQuerySchema.parse({ category: 'money', limit: '200', userId: NORA })).toEqual({
      category: 'money',
      limit: 200,
      userId: NORA,
    });
    expect(AuditQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(AuditQuerySchema.safeParse({ category: 'argent' }).success).toBe(false);
    expect(AuditQuerySchema.safeParse({ other: 'x' }).success).toBe(false);
    expect(AuditExportQuerySchema.safeParse({ cursor: 'x' }).success).toBe(false);
  });

  it('refuses a period that ends before it begins', () => {
    const from = '2026-11-01T00:00:00Z';
    expect(AuditExportQuerySchema.safeParse({ from, to: '2026-11-02T00:00:00+01:00' }).success).toBe(true);
    expect(AuditExportQuerySchema.safeParse({ from, to: from }).success).toBe(false);
    expect(AuditQuerySchema.safeParse({ from: '2026-11-02T00:00:00Z', to: from }).success).toBe(false);
  });
});
