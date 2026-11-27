import { CREATOR_ALERT_CODES, CREATOR_ALERT_DEFAULTS } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { creatorAlertLines, routeRowsOf } from '../creator-alerts';

describe('the Alertes tab of her sheet (ADR 0150)', () => {
  it('shows every alert on the defaults of the code when nothing is stored', () => {
    const lines = creatorAlertLines([]);
    expect(lines.map((line) => line.code)).toEqual([...CREATOR_ALERT_CODES]);
    for (const line of lines) {
      expect(line.routes).toEqual(CREATOR_ALERT_DEFAULTS[line.code]);
      expect(line.isDefault).toBe(true);
    }
  });

  it('takes a stored mode for its role, the defaults for the others', () => {
    const sale = creatorAlertLines([{ alertCode: 'sale', role: 'manager', mode: 'off' }]).find(
      (line) => line.code === 'sale',
    );
    expect(sale).toMatchObject({
      family: 'sales',
      locked: false,
      isDefault: false,
      routes: { owner: 'deliver', manager: 'off', chatter_on_shift: 'muted' },
    });
  });

  it('keeps the safety relays on deliver for everyone, whatever a row says', () => {
    const safety = creatorAlertLines([
      { alertCode: 'safety_handoff', role: 'chatter_on_shift', mode: 'off' },
    ]).find((line) => line.code === 'safety_handoff');
    expect(safety?.locked).toBe(true);
    expect(safety?.routes).toEqual({ owner: 'deliver', manager: 'deliver', chatter_on_shift: 'deliver' });
  });

  it('stores one row per role', () => {
    expect(routeRowsOf('ai_budget', { owner: 'deliver', manager: 'muted', chatter_on_shift: 'off' })).toEqual(
      [
        { alertCode: 'ai_budget', role: 'owner', mode: 'deliver' },
        { alertCode: 'ai_budget', role: 'manager', mode: 'muted' },
        { alertCode: 'ai_budget', role: 'chatter_on_shift', mode: 'off' },
      ],
    );
  });
});
