import { describe, expect, it } from 'vitest';

import {
  HE_WROTE_FIRST_GAP_MS,
  heWroteFirst,
  WORK_TEASE_COOLDOWN_MS,
  WORK_TEASE_MIN_SCRIPTS_BOUGHT,
  WORK_TEASE_SESSION_MS,
  workTeaseTurn,
  type WorkTeaseInput,
} from '../work-tease';

const NOW = new Date('2026-11-26T10:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const START: WorkTeaseInput = {
  previous: null,
  now: NOW,
  signals: ['busy_now'],
  scriptsBought: WORK_TEASE_MIN_SCRIPTS_BOUGHT,
  heWroteFirst: true,
  bites: false,
  allowed: true,
};

describe('the exception « au travail » (Charles 26/11)', () => {
  it('starts with a tease for a faithful fan who writes by himself from his work', () => {
    expect(workTeaseTurn(START)).toEqual({
      phase: 'tease',
      record: { startedAt: NOW, bitAt: null, stoppedAt: null },
    });
    // She teases first even when his first message already goes there.
    expect(workTeaseTurn({ ...START, bites: true }).phase).toBe('tease');
  });

  it('never starts for a fan with too few scripts, who did not write first, not at work, or not allowed', () => {
    expect(workTeaseTurn({ ...START, scriptsBought: WORK_TEASE_MIN_SCRIPTS_BOUGHT - 1 }).phase).toBe('none');
    expect(workTeaseTurn({ ...START, heWroteFirst: false }).phase).toBe('none');
    expect(workTeaseTurn({ ...START, signals: ['alone'] }).phase).toBe('none');
    expect(workTeaseTurn({ ...START, allowed: false }).phase).toBe('none');
    expect(workTeaseTurn({ ...START, signals: ['busy_now', 'someone_nearby'] }).phase).toBe('none');
  });

  it('happens at most once per span, counted per fan from the last start', () => {
    const last = { startedAt: ago(WORK_TEASE_COOLDOWN_MS - 60_000), bitAt: null, stoppedAt: ago(1) };
    expect(workTeaseTurn({ ...START, previous: last })).toEqual({ phase: 'none', record: last });
    const old = { ...last, startedAt: ago(WORK_TEASE_COOLDOWN_MS) };
    expect(workTeaseTurn({ ...START, previous: old }).phase).toBe('tease');
  });

  it('lets a script start once he bites, and keeps it so for the rest of the tease', () => {
    const live = { startedAt: ago(10 * 60_000), bitAt: null, stoppedAt: null };
    expect(workTeaseTurn({ ...START, previous: live, signals: [] }).phase).toBe('tease');
    const bit = workTeaseTurn({ ...START, previous: live, signals: [], bites: true });
    expect(bit).toEqual({ phase: 'may_start', record: { ...live, bitAt: NOW } });
    expect(workTeaseTurn({ ...START, previous: bit.record, signals: [] }).phase).toBe('may_start');
  });

  it('stops dead when he says he cannot, then the ordinary rule again', () => {
    const live = { startedAt: ago(10 * 60_000), bitAt: ago(60_000), stoppedAt: null };
    const stopped = workTeaseTurn({ ...START, previous: live, signals: ['slows_down'] });
    expect(stopped).toEqual({ phase: 'stopped', record: { ...live, stoppedAt: NOW } });
    expect(workTeaseTurn({ ...START, previous: stopped.record, bites: true }).phase).toBe('none');
    expect(workTeaseTurn({ ...START, previous: live, signals: ['someone_nearby'] }).phase).toBe('stopped');
  });

  it('is over past its span: his « au boulot » is the ordinary rule', () => {
    const past = { startedAt: ago(WORK_TEASE_SESSION_MS), bitAt: ago(60_000), stoppedAt: null };
    expect(workTeaseTurn({ ...START, previous: past, bites: true }).phase).toBe('none');
  });
});

describe('he wrote by himself', () => {
  const her = (at: Date) => ({ fromFan: false, at });
  const him = (at: Date) => ({ fromFan: true, at });

  it('when nothing of hers comes before, or hers is old', () => {
    expect(heWroteFirst([him(NOW)], NOW)).toBe(true);
    expect(heWroteFirst([her(ago(HE_WROTE_FIRST_GAP_MS + 60_000)), him(ago(60_000))], NOW)).toBe(true);
  });

  it('not when he answers a message she just wrote', () => {
    expect(heWroteFirst([her(ago(10 * 60_000)), him(ago(60_000))], NOW)).toBe(false);
    expect(heWroteFirst([{ fromFan: false }, him(NOW)], NOW)).toBe(false);
  });
});
