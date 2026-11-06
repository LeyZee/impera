/**
 * The arguments of an ops or setup command, checked before anything runs (recette 07/11, BIL-04): `--help` prints
 * the usage, and an option the command does not know, or one of its options without its value, prints the usage and
 * stops with code 1. Never a stack trace, and never the operation run with an argument it ignored.
 */
export interface KnownOptions {
  /** Options followed by a value: `--email <email>`. */
  readonly withValue?: readonly string[];
  /** Options alone: `--all`. */
  readonly alone?: readonly string[];
  /** Whether the command takes words that are not options (a file, an id). */
  readonly positionals?: boolean;
}

export type ArgumentsCheck = { readonly ok: true } | { readonly ok: false; readonly exitCode: 0 | 1 };

export function checkArguments(args: readonly string[], known: KnownOptions): ArgumentsCheck {
  const withValue = new Set(known.withValue ?? []);
  const alone = new Set(known.alone ?? []);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') return { ok: false, exitCode: 0 };
    const name = arg.startsWith('--') ? (arg.slice(2).split('=')[0] ?? '') : null;
    if (name === null) {
      if (arg.startsWith('-') || known.positionals !== true) return { ok: false, exitCode: 1 };
      continue;
    }
    if (alone.has(name) && !arg.includes('=')) continue;
    if (!withValue.has(name)) return { ok: false, exitCode: 1 };
    if (arg.includes('=')) continue;
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) return { ok: false, exitCode: 1 };
    index += 1;
  }
  return { ok: true };
}

/** Checks `process.argv` against `known`; on `--help` or a wrong argument, prints `usage` and exits. */
export function requireArguments(usage: string, known: KnownOptions = {}): void {
  const check = checkArguments(process.argv.slice(2), known);
  if (check.ok) return;
  (check.exitCode === 0 ? console.log : console.error)(usage);
  process.exit(check.exitCode);
}
