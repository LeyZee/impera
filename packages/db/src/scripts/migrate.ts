import { createDbClient } from '../client';
import { ensureServiceLogin, runMigrations } from '../migrate';

// `pnpm db:migrate`: applies the migrations with DATABASE_ADMIN_URL (the owner role, never the app or the service
// role), then lets the service role log in with the password of DATABASE_SERVICE_URL if it cannot yet (ADR 0087).
const url = process.env['DATABASE_ADMIN_URL'];
if (url === undefined || url === '') {
  console.error('DATABASE_ADMIN_URL is missing (see .env.example).');
  process.exit(1);
}
const serviceUrl = process.env['DATABASE_SERVICE_URL'];
const client = createDbClient(url, { max: 1 });
try {
  await runMigrations(client);
  console.log('Migrations applied.');
  if (serviceUrl !== undefined && serviceUrl !== '' && (await ensureServiceLogin(client, serviceUrl))) {
    console.log('Service role: login set from DATABASE_SERVICE_URL.');
  }
} finally {
  await client.close();
}
