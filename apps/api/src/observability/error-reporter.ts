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

/** An error's name: `TypeError`, `DOMException`, at most 60 characters. */
const ERROR_NAME = /^[A-Z][A-Za-z]{0,50}(?:Error|Exception)$/u;

/** `TypeError: x is undefined` → its type and its message; a message without a name is an `Error`. */
function typedMessage(message: string): { readonly type: string; readonly value: string } {
  const colon = message.indexOf(': ');
  const name = colon < 0 ? '' : message.slice(0, colon);
  return ERROR_NAME.test(name)
    ? { type: name, value: message.slice(colon + 2) }
    : { type: 'Error', value: message };
}

/** `file:12:34` → its file, line and column; read from the end, without a pattern that could backtrack. */
function locationOf(text: string): { filename: string; lineno: number; colno: number } | null {
  const second = text.lastIndexOf(':');
  const first = second < 0 ? -1 : text.lastIndexOf(':', second - 1);
  if (first <= 0) return null;
  const lineno = text.slice(first + 1, second);
  const colno = text.slice(second + 1);
  if (!/^\d{1,9}$/u.test(lineno) || !/^\d{1,9}$/u.test(colno)) return null;
  return { filename: text.slice(0, first), lineno: Number(lineno), colno: Number(colno) };
}

/**
 * One line of a browser's stack: Chrome's `at f (file:1:2)` or `at file:1:2`, Firefox's and Safari's `f@file:1:2`.
 * Read by positions, in one pass: a stack of 4 000 hostile characters costs nothing more.
 */
function frameOfLine(raw: string): StackFrame | null {
  const line = raw.trim();
  let name = '';
  let location: string;
  if (line.startsWith('at ')) {
    const rest = line.slice(3);
    const open = rest.lastIndexOf(' (');
    if (open >= 0 && rest.endsWith(')')) {
      name = rest.slice(0, open);
      location = rest.slice(open + 2, -1);
    } else {
      location = rest;
    }
  } else {
    const at = line.indexOf('@');
    if (at < 0) return null;
    name = line.slice(0, at);
    location = line.slice(at + 1);
  }
  const place = locationOf(location);
  return place === null ? null : { ...place, function: name === '' ? '?' : name, in_app: true };
}

/** A browser's stack as Sentry's frames, oldest first. */
export function framesOfBrowserStack(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n')) {
    const frame = frameOfLine(line);
    if (frame !== null) frames.push(frame);
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
      // The event's release is the API's (`config.RELEASE`): what the browser says is only a tag (Sécurité on #895).
      captureEvent({
        level: 'error',
        platform: 'javascript',
        exception: { values: [exception] },
        tags: { ...tagsOf({ service: 'web', route: report.route }), web_release: report.release },
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
