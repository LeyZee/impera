import type { ClientErrorReport } from '@impera/contracts';
import {
  captureEvent,
  captureException,
  flush,
  initWithoutDefaultIntegrations,
  nodeContextIntegration,
  withScope,
  type Exception,
  type NodeOptions,
  type StackFrame,
} from '@sentry/node';

import type { Config } from '../config';
import { storableError } from '../database-errors';

import { scrubEvent } from './scrub';

/** Which part of Impera an error came from: the `service` tag. */
export type ReportedService = 'api' | 'worker' | 'web';

/** Where an error happened, never who nor what: the only tags `scrubEvent` lets through. */
export interface ReportPlace {
  readonly service: ReportedService;
  /** An HTTP route's template (`/v1/fans/:fanId`), never the address asked. */
  readonly route?: string;
  readonly method?: string;
  /** A job's task identifier. */
  readonly task?: string;
  readonly attempt?: number;
}

/** Where production errors go (OPS-18, operations.md § Observabilité). */
export interface ErrorReporter {
  /** False without a DSN: nothing is sent, nothing is listened to. */
  readonly isEnabled: boolean;
  /** An error of the API or the worker, reduced as the logs reduce it (`storableError`) before the scrubber. */
  captureException(error: unknown, place: ReportPlace): void;
  /** An error the dashboard reported (`POST /v1/client-errors`). */
  captureClientError(report: ClientErrorReport): void;
  /** Sends what is pending, for at most `timeoutMs`; never throws. */
  flush(timeoutMs: number): Promise<void>;
}

/** Without a DSN (development, the tests): no client, no network. */
export const INERT_ERROR_REPORTER: ErrorReporter = {
  isEnabled: false,
  captureException: () => undefined,
  captureClientError: () => undefined,
  flush: () => Promise.resolve(),
};

const tagsOf = (place: ReportPlace): Record<string, string> => ({
  service: place.service,
  ...(place.route === undefined ? {} : { route: place.route }),
  ...(place.task === undefined ? {} : { task: place.task }),
  ...(place.attempt === undefined ? {} : { attempt: String(place.attempt) }),
});

/** `TypeError: x is undefined` → its type and its message; a message without a name is an `Error`. */
function typedMessage(message: string): { readonly type: string; readonly value: string } {
  const named = /^([A-Z][A-Za-z]*(?:Error|Exception)): ([\s\S]*)$/u.exec(message);
  return named?.[1] === undefined || named[2] === undefined
    ? { type: 'Error', value: message }
    : { type: named[1], value: named[2] };
}

const CHROME_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/u;
const GECKO_FRAME = /^(.*?)@(.+?):(\d+):(\d+)\s*$/u;

/** A browser's stack (Chrome's `at f (file:1:2)` or Firefox's and Safari's `f@file:1:2`) as Sentry's frames, oldest first. */
export function framesOfBrowserStack(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n')) {
    const match = CHROME_FRAME.exec(line) ?? GECKO_FRAME.exec(line);
    if (match === null) continue;
    const [, name, filename, lineno, colno] = match;
    if (filename === undefined || lineno === undefined || colno === undefined) continue;
    frames.push({
      filename,
      function: name === undefined || name === '' ? '?' : name,
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: true,
    });
  }
  return frames.reverse();
}

/** How Sentry is started; the tests give their own transport and look at what would have been sent. */
export interface ErrorReportingOptions {
  readonly transport?: NodeOptions['transport'];
}

/**
 * Starts Sentry when `SENTRY_DSN` is set, inert otherwise. Errors only: no performance, no breadcrumbs, no local
 * variables, no default integration (none reads a request, a body or the console), the runtime and the system as the
 * only context, and every event through `scrubEvent` before it leaves.
 */
export function startErrorReporting(
  config: Pick<Config, 'SENTRY_DSN' | 'RELEASE' | 'NODE_ENV'>,
  options: ErrorReportingOptions = {},
): ErrorReporter {
  if (config.SENTRY_DSN === undefined) return INERT_ERROR_REPORTER;
  const client = initWithoutDefaultIntegrations({
    dsn: config.SENTRY_DSN,
    release: config.RELEASE,
    environment: config.NODE_ENV,
    // What `sendDefaultPii: false` was before Sentry 11: no category of data collected, each said by its name.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    includeLocalVariables: false,
    sendClientReports: false,
    integrations: [
      nodeContextIntegration({ app: false, device: false, culture: false, cloudResource: false }),
    ],
    beforeSend: scrubEvent,
    ...(options.transport === undefined ? {} : { transport: options.transport }),
  });
  // In a worker thread Sentry starts nothing.
  if (client === undefined) return INERT_ERROR_REPORTER;
  return {
    isEnabled: true,
    captureException: (error, place) => {
      withScope((scope) => {
        scope.setTags(tagsOf(place));
        const { method, route } = place;
        if (method !== undefined) {
          scope.addEventProcessor((event) => ({
            ...event,
            request: { method, ...(route === undefined ? {} : { url: route }) },
          }));
        }
        captureException(storableError(error));
      });
    },
    captureClientError: (report) => {
      const frames = framesOfBrowserStack(report.stack);
      const exception: Exception = {
        ...typedMessage(report.message),
        mechanism: { type: 'onerror', handled: false },
        ...(frames.length === 0 ? {} : { stacktrace: { frames } }),
      };
      captureEvent({
        level: 'error',
        platform: 'javascript',
        release: report.release,
        exception: { values: [exception] },
        tags: tagsOf({ service: 'web', route: report.route }),
      });
    },
    flush: async (timeoutMs) => {
      try {
        await flush(timeoutMs);
      } catch {
        // A report that could not leave is lost, never a reason to stop differently.
      }
    },
  };
}
