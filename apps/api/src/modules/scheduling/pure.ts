/**
 * The pure rules scheduling lends the modules that depend on it (ADR 0051): re-exports of `domain/` only, no code
 * written here, no I/O. Everything else goes through `index.ts`.
 */
export { addDays, isoWeekday, wallClockToInstant } from './domain/time';
