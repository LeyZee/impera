import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

/**
 * A signed GET of an object sent over `node:http`, never `fetch` (MED-04, recette 06/11). Node 22.23's undici (6.29)
 * asserts `!this.paused` when the storage closes the connection (`Connection: close`, as moto and some S3 front ends
 * answer) while a slow reader holds the body back: an uncaught `AssertionError` that takes the API or the worker
 * down. `node:http` reads the same answer and waits for the reader. Same contract as `fetch`: the answer once the
 * headers are in, its body read as it comes; `signal` aborts the request and the body.
 */
export function nodeGet(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = send(url, {
      method: 'GET',
      headers: Object.fromEntries(request.headers),
      signal: request.signal,
    });
    outgoing.once('response', (incoming: IncomingMessage) => {
      const headers = new Headers();
      for (let index = 0; index + 1 < incoming.rawHeaders.length; index += 2) {
        const [name, value] = [incoming.rawHeaders[index], incoming.rawHeaders[index + 1]];
        if (name !== undefined && value !== undefined) headers.append(name, value);
      }
      const status = incoming.statusCode ?? 0;
      const empty = status === 204 || status === 304;
      try {
        // A status `Response` refuses (outside 200–599) is a storage that does not answer: rejected, never thrown here.
        resolve(new Response(empty ? null : Readable.toWeb(incoming), { status, headers }));
        if (empty) incoming.resume();
      } catch (error) {
        incoming.destroy();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    outgoing.once('error', reject);
    outgoing.end();
  });
}
