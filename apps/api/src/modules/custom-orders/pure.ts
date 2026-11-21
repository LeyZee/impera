/**
 * The pure rules custom-orders lends the modules that depend on it (ADR 0051): re-exports of `domain/` only, no code
 * written here, no I/O. Everything else goes through `index.ts`.
 */
/** @public The agent's turn on a custom request, which `conversations` carries from the composer to the store. */
export type { CustomOrderTurn } from './domain/turn';
