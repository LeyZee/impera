// Violation: a pure.ts re-exports its own domain only, never its infra.
export { fansRepository } from './infra/repository';
