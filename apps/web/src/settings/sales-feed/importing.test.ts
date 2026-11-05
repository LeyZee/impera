import {
  CreatorIdSchema,
  SalesFeedImportCandidateSchema,
  type PlatformModel,
  type SalesFeedImportCandidate,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  actionOf,
  actionValue,
  creatorOptionsOf,
  foundTitle,
  initialsOf,
  isStatusWarning,
  modelLabel,
  proposalWhy,
  proposedChoice,
  refusalLine,
  selectedLines,
  statusLabel,
  summaryOf,
  type ImportChoice,
} from './importing';

const NORA = CreatorIdSchema.parse('00000000-0000-4000-8000-0000000000c1');
const ZOE = CreatorIdSchema.parse('00000000-0000-4000-8000-0000000000c2');

const model = (patch: Partial<PlatformModel> = {}): PlatformModel => ({
  platformModelId: 'm1',
  handle: 'nora.fake',
  displayName: 'Nora Test',
  isActive: true,
  status: 'validated',
  avatarUrl: null,
  ...patch,
});

const candidate = (patch: Partial<SalesFeedImportCandidate> = {}): SalesFeedImportCandidate =>
  SalesFeedImportCandidateSchema.parse({
    model: model(),
    proposal: { kind: 'create' },
    preselected: true,
    ...patch,
  });

describe('the review of the import (CRM-07)', () => {
  it('names her by her name and handle, her handle alone when the platform gives no name', () => {
    expect(modelLabel(model())).toBe('Nora Test (@nora.fake)');
    expect(modelLabel(model({ displayName: '  ' }))).toBe('@nora.fake');
    expect(initialsOf('Nora Test')).toBe('NT');
    expect(initialsOf('@nora.fake')).toBe('NF');
    expect(initialsOf('élodie')).toBe('É');
  });

  it('says where she stands, amber when it deserves a second look', () => {
    expect(statusLabel(model(), 'Reveal')).toBe('Validée');
    expect(statusLabel(model({ isActive: false }), 'Reveal')).toBe('Validée, inactive');
    expect(statusLabel(model({ status: 'pending' }), 'Reveal')).toBe('En attente chez Reveal');
    expect(isStatusWarning(model())).toBe(false);
    expect(isStatusWarning(model({ status: 'banned' }))).toBe(true);
    expect(isStatusWarning(model({ isActive: false }))).toBe(true);
  });

  it('starts from what the server proposed, and sends only the lines ticked, in order', () => {
    const linked = candidate({
      model: model({ platformModelId: 'm2', handle: 'zoe' }),
      proposal: { kind: 'link', creatorId: ZOE, creatorDisplayName: 'Zoé', match: 'handle' },
      preselected: true,
    });
    const pending = candidate({
      model: model({ platformModelId: 'm3', status: 'pending' }),
      preselected: false,
    });
    expect(proposedChoice(linked)).toEqual({ selected: true, action: { kind: 'link', creatorId: ZOE } });
    expect(proposalWhy(linked)).toBe('Même pseudo qu’un compte de Zoé');
    expect(proposalWhy(pending)).toBeNull();

    const choices = new Map<string, ImportChoice>([['m1', { selected: false, action: { kind: 'create' } }]]);
    expect(selectedLines([candidate(), linked, pending], choices)).toEqual([
      { platformModelId: 'm2', action: { kind: 'link', creatorId: ZOE } },
    ]);
  });

  it('offers every creator by name, and the one proposed before the list is read', () => {
    const linked = candidate({
      proposal: { kind: 'link', creatorId: ZOE, creatorDisplayName: 'Zoé', match: 'name' },
    });
    expect(creatorOptionsOf([], [linked])).toEqual([{ id: ZOE, name: 'Zoé' }]);
    const options = creatorOptionsOf(
      [
        { id: ZOE, displayName: 'Zoé', timezone: 'Europe/Paris' },
        { id: NORA, displayName: 'Ambre', timezone: 'Europe/Paris' },
      ],
      [linked],
    );
    expect(options.map((option) => option.name)).toEqual(['Ambre', 'Zoé']);
    expect(actionOf(actionValue({ kind: 'link', creatorId: NORA }), options)).toEqual({
      kind: 'link',
      creatorId: NORA,
    });
    // A creator the menu does not know reads as « create », never as an id taken from the page.
    expect(actionOf('link:00000000-0000-4000-8000-0000000000ff', options)).toEqual({ kind: 'create' });
  });

  it('sums an import up, and words each refusal', () => {
    expect(
      summaryOf([
        { platformModelId: 'm1', outcome: 'created', creatorId: NORA },
        { platformModelId: 'm2', outcome: 'created', creatorId: ZOE },
        { platformModelId: 'm3', outcome: 'refused', reason: 'name_taken' },
      ]),
    ).toBe('2 créées, 1 refusée.');
    expect(summaryOf([])).toBe('Rien n’a été importé.');
    expect(refusalLine('not_listed', 'Reveal')).toBe('Reveal ne la liste plus.');
    expect(foundTitle(1, 'Reveal')).toBe('1 créatrice trouvée sur Reveal');
    expect(foundTitle(0, 'Reveal')).toBe('Aucune nouvelle créatrice sur Reveal');
  });
});
