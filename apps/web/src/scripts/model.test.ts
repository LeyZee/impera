import {
  SCRIPT_COLOR_PRESETS,
  SCRIPT_SEGMENTS_MAX,
  SCRIPT_STARTERS,
  type ScriptSegment,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  addBridgeAfter,
  addStage,
  canBridgeAfter,
  emptyDraft,
  flat,
  inkOf,
  issuesOf,
  move,
  nextLetter,
  presetOf,
  remove,
  segmentTitles,
  slotsSummary,
  type Draft,
} from './model';

const starter = (): Draft => {
  const first = SCRIPT_STARTERS[0];
  if (first === undefined) throw new Error('no starter');
  return structuredClone(first.body);
};
const keys = (segments: readonly ScriptSegment[]): string[] => segments.map((segment) => segment.key);

describe('the workshop draft', () => {
  it('starts a new structure that the contract takes', () => {
    expect(issuesOf(emptyDraft()).size).toBe(0);
    expect(issuesOf(starter()).size).toBe(0);
  });

  it('adds stages under keys never taken', () => {
    let segments = emptyDraft().segments;
    segments = addStage(segments, null);
    segments = addStage(segments, 0);
    expect(keys(segments)).toEqual(['etape-1', 'etape-3', 'etape-2']);
  });

  it('refuses a stage past the limit', () => {
    let segments = emptyDraft().segments;
    for (let n = 0; n < SCRIPT_SEGMENTS_MAX + 2; n += 1) segments = addStage(segments, null);
    expect(segments).toHaveLength(SCRIPT_SEGMENTS_MAX);
  });

  it('offers a bridge only between two stages side by side, linked by their keys', () => {
    const segments = addStage(emptyDraft().segments, null);
    expect(canBridgeAfter(segments, 0)).toBe(true);
    expect(canBridgeAfter(segments, 1)).toBe(false);
    const bridged = addBridgeAfter(segments, 0);
    expect(bridged[1]).toMatchObject({ kind: 'bridge', from: 'etape-1', to: 'etape-2' });
    expect(canBridgeAfter(bridged, 0)).toBe(false);
    expect(issuesOf({ ...emptyDraft(), segments: bridged }).size).toBe(0);
  });

  it('drops a bridge whose stages are no longer its neighbours', () => {
    const draft = starter();
    const bridgeAt = draft.segments.findIndex((segment) => segment.kind === 'bridge');
    const moved = move(draft.segments, bridgeAt - 1, -1);
    expect(moved.filter((segment) => segment.kind === 'bridge')).toHaveLength(
      draft.segments.filter((segment) => segment.kind === 'bridge').length - 1,
    );
    expect(issuesOf({ ...draft, segments: moved }).size).toBe(0);
  });

  it('removes a stage with its bridges, never the last stage', () => {
    const draft = starter();
    const bridgeAt = draft.segments.findIndex((segment) => segment.kind === 'bridge');
    const removed = remove(draft.segments, bridgeAt + 1);
    expect(issuesOf({ ...draft, segments: removed }).size).toBe(0);
    const one = emptyDraft().segments;
    expect(remove(one, 0)).toEqual(one);
  });

  it('keeps a move inside the stack', () => {
    const segments = addStage(emptyDraft().segments, null);
    expect(move(segments, 0, -1)).toEqual(segments);
    expect(keys(move(segments, 0, 1))).toEqual(['etape-2', 'etape-1']);
  });

  it('titles segments as the card does', () => {
    const draft = starter();
    const titles = segmentTitles(draft.segments);
    const bridge = draft.segments.find((segment) => segment.kind === 'bridge');
    expect(titles.get(draft.segments[0]?.key ?? '')).toBe('Étape 1');
    expect(titles.get(bridge?.key ?? '')).toBe('Pont 2 & 3');
  });

  it('says where the server would refuse, in French', () => {
    const draft = starter();
    const first = draft.segments[0];
    if (first?.kind !== 'stage') throw new Error('stage expected');
    const issues = issuesOf({
      ...draft,
      name: ' ',
      segments: [{ ...first, name: '' }, ...draft.segments.slice(1)],
    });
    expect(issues.get('name')).toEqual(['Un champ est vide']);
    expect(issues.get(first.key)).toEqual(['Un champ est vide']);
  });

  it('refuses a colour no ink reads on', () => {
    const grey = flat('#777777');
    expect(inkOf(grey)).toBeNull();
    expect(issuesOf({ ...emptyDraft(), color: grey }).has('color')).toBe(true);
    expect(presetOf(SCRIPT_COLOR_PRESETS[3].color)).toBe('or-rose');
    expect(presetOf(grey)).toBeNull();
  });

  it('gives the next series letter, none past C', () => {
    const stage = emptyDraft().segments[0];
    if (stage?.kind !== 'stage') throw new Error('stage expected');
    expect(nextLetter(stage)).toBe('A');
    expect(
      nextLetter({
        ...stage,
        variants: [
          { letter: 'A', hint: 'x' },
          { letter: 'C', hint: 'y' },
        ],
      }),
    ).toBe('B');
    expect(
      nextLetter({
        ...stage,
        variants: [
          { letter: 'A', hint: 'x' },
          { letter: 'B', hint: 'y' },
          { letter: 'C', hint: 'z' },
        ],
      }),
    ).toBeNull();
  });

  it('sums up what to shoot', () => {
    const stage = emptyDraft().segments[0];
    if (stage?.kind !== 'stage') throw new Error('stage expected');
    expect(slotsSummary(stage.mediaSlots)).toBe('3 photos, 1 vidéo');
    expect(slotsSummary([])).toBe('Rien à tourner');
  });
});
