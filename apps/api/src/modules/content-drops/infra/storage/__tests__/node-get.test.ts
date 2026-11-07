import { createServer, type Server, type Socket } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { nodeGet } from '../node-get';

const SIZE = 2_000_000;

/**
 * A storage that answers as moto does (MED-04): `Content-Length`, `Connection: close`, then its FIN right after the
 * body, whoever reads it and however slowly. `/missing` answers 404 with a small body; `/stall` sends headers only.
 */
function storage(): Server {
  return createServer((socket: Socket) => {
    socket.once('data', (head) => {
      const path = /^GET (\S+)/u.exec(head.toString('latin1'))?.[1] ?? '/';
      if (path === '/stall') {
        socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${String(SIZE)}\r\nConnection: close\r\n\r\n`);
        return;
      }
      const body = path === '/missing' ? Buffer.from('<Code>NoSuchKey</Code>') : Buffer.alloc(SIZE, 7);
      const status = path === '/missing' ? '404 Not Found' : '200 OK';
      socket.write(
        `HTTP/1.1 ${status}\r\nContent-Length: ${String(body.length)}\r\nConnection: close\r\nX-Amz-Request-Id: test\r\n\r\n`,
      );
      socket.end(body);
    });
    socket.on('error', () => undefined);
  });
}

describe('nodeGet: an object read over node:http (MED-04)', () => {
  const server = storage();
  let base = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${String(address.port)}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('reads a body the storage closes after, however slowly the reader takes it, again and again', async () => {
    for (let round = 0; round < 4; round += 1) {
      const response = await nodeGet(new Request(`${base}/object`, { headers: { authorization: 'signed' } }));
      expect(response.status).toBe(200);
      expect(response.headers.get('x-amz-request-id')).toBe('test');
      if (response.body === null) throw new Error('no body');
      const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
      let bytes = 0;
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        bytes += chunk.value.length;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(bytes).toBe(SIZE);
    }
  });

  it('gives an error status with its body, as fetch does', async () => {
    const response = await nodeGet(new Request(`${base}/missing`));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('<Code>NoSuchKey</Code>');
  });

  it('aborts a body that stalls when its signal fires', async () => {
    const abort = new AbortController();
    const response = await nodeGet(new Request(`${base}/stall`, { signal: abort.signal }));
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('no body');
    const read = reader.read();
    abort.abort();
    await expect(read).rejects.toThrow();
  });

  it('rejects when nothing answers', async () => {
    await expect(nodeGet(new Request('http://127.0.0.1:1/object'))).rejects.toThrow();
  });
});
