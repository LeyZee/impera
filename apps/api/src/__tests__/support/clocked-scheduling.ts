import { createRequireRecentLogin } from '../../auth';
import { createLogger } from '../../logger';
import { salesFeedReadsForReports, salesFeedSwitchReads, salesFeedTotals } from '../../modules/connectors';
import { conversationReadsForShifts } from '../../modules/conversations';
import { enqueuePayRecalculation, payReadsForPayRules } from '../../modules/payroll';
import { createSchedulingModule } from '../../modules/scheduling';
import { buildServer, type Server } from '../../server';

import { testConfig } from './config';
import type { PayrollTeam } from './payroll-team';

/**
 * The planning's routes on a clock of the test's (EQ-02): the app wires the scheduling module on the system's clock,
 * which the planning reads for « before it starts » and « at the end of the shift ». Same dependencies as
 * `wiring/scheduling.ts`, on the team's database and sessions; served alone, as `team.call(…, via)` reaches it.
 */
export async function clockedScheduling(team: PayrollTeam, now: () => Date): Promise<Server> {
  const { app, test } = team;
  const persona = app.modules.persona;
  const module = createSchedulingModule({
    db: app.db.db,
    adminDb: app.adminDb.db,
    creators: {
      list: async () => {
        const [all, open] = await Promise.all([
          persona.creators.list('all'),
          persona.creators.unarchived('all'),
        ]);
        const listed = new Set(open.map((creator) => creator.id));
        return all.map((creator) => ({ ...creator, archived: !listed.has(creator.id) }));
      },
    },
    enqueuePayRecalculation,
    switchFactsOf: salesFeedSwitchReads.switchFactsOf,
    periodClosedFrom: payReadsForPayRules.closedFrom,
    salesTotalsOf: salesFeedTotals.totalsOf,
    shiftSalesOf: salesFeedReadsForReports.shiftSales,
    shiftActivityOf: conversationReadsForShifts.activity,
    creatorAgendaFeed: app.modules.creatorTasks.feedOf,
    notify: app.modules.notifications.notify,
    now,
  });
  const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
  return buildServer({
    config,
    logger: createLogger(config),
    routes: [module.routes(app.requireRole, createRequireRecentLogin(app.auth, app.db.db))],
    readiness: app.readiness,
  });
}
