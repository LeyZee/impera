import { describe, expect, it } from 'vitest';

import { checkArguments } from '../command-line';

describe('the arguments of an ops command (recette 07/11, BIL-04)', () => {
  const killSwitch = { withValue: ['scope', 'id', 'reason'], alone: ['on', 'off'] };

  it('lets the arguments of the command through', () => {
    expect(checkArguments(['--on', '--scope', 'global', '--reason', 'panne'], killSwitch)).toEqual({
      ok: true,
    });
    expect(checkArguments(['--', '--off', '--scope=global', '--reason=fin'], killSwitch)).toEqual({
      ok: true,
    });
    expect(
      checkArguments(['persona.yaml', '--activate'], { alone: ['activate'], positionals: true }),
    ).toEqual({
      ok: true,
    });
    expect(checkArguments([], {})).toEqual({ ok: true });
  });

  it('answers --help with the usage, and success', () => {
    expect(checkArguments(['--help'], killSwitch)).toEqual({ ok: false, exitCode: 0 });
    expect(checkArguments(['-h'], {})).toEqual({ ok: false, exitCode: 0 });
  });

  it('stops on an option it does not know, an option without its value, or a word it does not take', () => {
    expect(checkArguments(['--onn', '--scope', 'global'], killSwitch)).toEqual({ ok: false, exitCode: 1 });
    expect(checkArguments(['--on', '--scope'], killSwitch)).toEqual({ ok: false, exitCode: 1 });
    expect(checkArguments(['--on', '--scope', '--reason', 'x'], killSwitch)).toEqual({
      ok: false,
      exitCode: 1,
    });
    // A command without arguments never runs with one it would ignore: the re-encryption, the key check.
    expect(checkArguments(['--dry-run'], {})).toEqual({ ok: false, exitCode: 1 });
    expect(checkArguments(['v2'], {})).toEqual({ ok: false, exitCode: 1 });
    expect(checkArguments(['-x'], { positionals: true })).toEqual({ ok: false, exitCode: 1 });
    expect(checkArguments(['--on=oui'], killSwitch)).toEqual({ ok: false, exitCode: 1 });
  });
});
