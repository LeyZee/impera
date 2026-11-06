import { DEFAULT_SANDBOX_URL, isLoopbackUrl } from '../../sandbox';

import { createWorld } from './world';

/**
 * `pnpm sandbox:world`: the recette sandbox's fake world (ADR 0075), on this machine only. Its address is the API's
 * `IMPERA_SANDBOX_URL` (`http://127.0.0.1:4010` by default); any other host is refused.
 */
// As in the API's configuration, an empty value (the `.env.example` line) means unset.
const configured = process.env['IMPERA_SANDBOX_URL']?.trim();
const wanted = configured === undefined || configured === '' ? DEFAULT_SANDBOX_URL : configured;
if (!isLoopbackUrl(wanted)) {
  process.stderr.write(`IMPERA_SANDBOX_URL doit être une adresse de cette machine (ADR 0075) : ${wanted}\n`);
  process.exit(1);
}
const address = new URL(wanted);
const world = createWorld();
await world.app.listen({ host: address.hostname.replace(/^\[|\]$/gu, ''), port: Number(address.port || 80) });
process.stdout.write(
  `Bac à sable : le faux monde écoute sur ${address.origin} (état : ${address.origin}/__)\n`,
);
