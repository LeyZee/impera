/**
 * Re-seals every secret kept under CREDENTIALS_ENCRYPTION_KEYS with the newest key after a rotation
 * (runbooks/rotate-secrets.md): the AI service keys of Réglages › Modèles IA, the Telegram bot tokens and the sales feed keys (ADR 0050). Any later
 * secret sealed with the same keys adds its own re-sealer below.
 * Usage: `pnpm ops:reencrypt-credentials`, with `CREDENTIALS_ENCRYPTION_KEYS=v2:<nouvelle>,v1:<ancienne>`.
 */
import { createDbClient, parseEncryptionKeys } from '@impera/db';

import { loadConfig, ownerDatabaseUrl, secretOrNull } from '../config';
import { resealSalesFeedCredentials } from '../modules/connectors';
import { resealProviderCredentials } from '../modules/providers';
import { resealTelegramTokens } from '../modules/telegram';

import { requireArguments } from './command-line';

requireArguments(
  'Usage: pnpm ops:reencrypt-credentials (avec CREDENTIALS_ENCRYPTION_KEYS=v2:<nouvelle>,v1:<ancienne>)',
);

const config = loadConfig();
const keys = secretOrNull(config.CREDENTIALS_ENCRYPTION_KEYS);
if (keys === null) {
  console.error('CREDENTIALS_ENCRYPTION_KEYS manque dans l’environnement.');
  process.exit(1);
}
const admin = createDbClient(ownerDatabaseUrl(config));
try {
  const parsed = parseEncryptionKeys(keys, 'CREDENTIALS_ENCRYPTION_KEYS');
  const version = parsed[0]?.version ?? '?';
  const services = await resealProviderCredentials(admin.db, parsed);
  console.log(`${String(services.rewritten)} clé(s) de service IA rechiffrée(s) en ${version}.`);
  const bots = await resealTelegramTokens(admin.db, parsed);
  console.log(`${String(bots.rewritten)} jeton(s) de bot Telegram rechiffré(s) en ${version}.`);
  const feeds = await resealSalesFeedCredentials(admin.db, parsed);
  console.log(`${String(feeds.rewritten)} clé(s) de lecture des ventes rechiffrée(s) en ${version}.`);
  const unreadable = [...services.unreadable, ...bots.unreadable, ...feeds.unreadable];
  if (unreadable.length > 0) {
    console.error(
      `Illisible(s) avec ces clés : ${unreadable.join(', ')}. Ne retire pas l’ancienne clé de chiffrement : remets-la, relance la commande.`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await admin.close();
}
