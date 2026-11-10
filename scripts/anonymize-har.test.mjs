// Tests of scripts/anonymize-har.mjs. Run: pnpm test:scripts
// Every value below is invented.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAnonymizer, findLeaks, maskContacts } from './anonymize-har.mjs';

// Built at runtime so secret scanners do not flag the fixture itself.
const FAKE_JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NSJ9', 'c2lnbmF0dXJl'].join('.');

const fakeHar = () => ({
  log: {
    version: '1.2',
    creator: { name: 'WebInspector', version: '537.36' },
    pages: [{ id: 'page_1', title: 'Messages avec Kevin Exemple' }],
    entries: [
      {
        _initiator: { type: 'script', stack: {} },
        request: {
          method: 'POST',
          url: 'https://api.example-reveal.test/v1/chats/48151623/messages?token=abc123secretvalue&limit=20',
          headers: [
            { name: 'Cookie', value: 'sid=s3cr3t-session-value' },
            { name: 'Authorization', value: `Bearer ${FAKE_JWT}` },
            { name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0)' },
            { name: 'X-CSRF-Token', value: 'csrf-value-0001' },
          ],
          cookies: [{ name: 'sid', value: 's3cr3t-session-value' }],
          queryString: [
            { name: 'token', value: 'abc123secretvalue' },
            { name: 'limit', value: '20' },
          ],
          postData: {
            mimeType: 'application/json',
            text: JSON.stringify({
              text: 'Coucou Kevin, tu fais quoi ce soir ?',
              price: 15,
              messageType: 'ppv',
            }),
          },
        },
        response: {
          status: 200,
          headers: [{ name: 'Set-Cookie', value: 'sid=new-session-value; HttpOnly' }],
          cookies: [],
          content: {
            mimeType: 'application/json',
            text: JSON.stringify({
              id: 'a3f1c2d4-5b6e-4f70-8a9b-0c1d2e3f4a5b',
              fanId: 987654321,
              username: 'kevin_du_75',
              email: 'kevin@example.test',
              createdAt: '2026-10-17T15:04:05Z',
              sentAt: 1792252800000,
              status: 'sent',
              price: { amount: 1500, currency: 'USD' },
              avatar:
                'https://cdn.example-reveal.test/avatars/987654321/a.jpg?Expires=1792252800&Signature=zzz',
              items: Array.from({ length: 25 }, (_, i) => ({ id: i + 1 })),
            }),
          },
        },
        _webSocketMessages: [
          {
            type: 'receive',
            time: 1792252800.1,
            opcode: 1,
            data: '42["message",{"chatId":"48151623","body":"salut"}]',
          },
          { type: 'send', time: 1792252801.2, opcode: 1, data: '2' },
        ],
      },
    ],
  },
});

const run = (salt = 'test-salt') => {
  const anonymizer = createAnonymizer(salt);
  const out = anonymizer.anonymizeHar(fakeHar());
  return { out, json: JSON.stringify(out), stats: anonymizer.stats };
};

test('removes cookies, tokens and authorization values', () => {
  const { out, json } = run();
  for (const secret of [
    's3cr3t-session-value',
    'abc123secretvalue',
    'csrf-value-0001',
    'eyJhbGci',
    'new-session',
  ]) {
    assert.ok(!json.includes(secret), `${secret} leaked`);
  }
  const headers = Object.fromEntries(out.log.entries[0].request.headers.map((h) => [h.name, h.value]));
  assert.match(headers.Cookie, /^<redacted:\d+>$/);
  assert.equal(headers['User-Agent'], 'Mozilla/5.0 (Windows NT 10.0)');
  assert.equal(out.log.entries[0].request.cookies[0].name, 'sid');
  assert.deepEqual(findLeaks(json), []);
});

test('replaces free text, names and contact details', () => {
  const { json } = run();
  for (const personal of ['Kevin', 'kevin_du_75', 'kevin@example.test', 'ce soir', 'salut']) {
    assert.ok(!json.includes(personal), `${personal} leaked`);
  }
  assert.ok(json.includes('<txt:'));
});

test('keeps the shape of the API: keys, enums, prices, dates, path and query names', () => {
  const { out } = run();
  const entry = out.log.entries[0];
  const body = JSON.parse(entry.response.content.text);
  assert.equal(body.status, 'sent');
  assert.deepEqual(body.price, { amount: 1500, currency: 'USD' });
  assert.equal(body.createdAt, '2026-10-17T15:04:05Z');
  assert.equal(body.sentAt, 1792252800000);
  assert.equal(JSON.parse(entry.request.postData.text).messageType, 'ppv');
  assert.equal(JSON.parse(entry.request.postData.text).price, 15);
  assert.match(
    entry.request.url,
    /^https:\/\/api\.example-reveal\.test\/v1\/chats\/:id_[0-9a-f]{10}\/messages\?/,
  );
  assert.match(entry.request.url, /limit=20/);
  assert.equal(body.items.length, 21);
  assert.equal(body.items.at(-1), '<+5 more>');
  assert.equal(entry._initiator, undefined);
});

test('hashes identifiers stably for a given salt, differently across salts', () => {
  const a = JSON.parse(run('salt-a').out.log.entries[0].response.content.text);
  const b = JSON.parse(run('salt-a').out.log.entries[0].response.content.text);
  const c = JSON.parse(run('salt-b').out.log.entries[0].response.content.text);
  assert.match(a.id, /^uuid_[0-9a-f]{10}$/);
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
  assert.equal(String(a.fanId).length, 9);
  assert.notEqual(a.fanId, 987654321);
  assert.equal(a.fanId, b.fanId);
});

test('scrubs WebSocket frames behind a socket.io prefix', () => {
  const { out } = run();
  const [frame, ping] = out.log.entries[0]._webSocketMessages;
  assert.ok(frame.data.startsWith('42["message",{'));
  assert.ok(!frame.data.includes('48151623'));
  assert.ok(!frame.data.includes('salut'));
  assert.equal(ping.data, '2');
});

test('the same chat id gets the same hash in a URL path and in a WebSocket frame', () => {
  const { out } = run();
  const entry = out.log.entries[0];
  const fromUrl = /chats\/:(id_[0-9a-f]{10})/.exec(entry.request.url)[1];
  const fromFrame = JSON.parse(entry._webSocketMessages[0].data.slice(2))[1].chatId;
  assert.equal(fromFrame, fromUrl);
});

test('drops signed query values from media URLs', () => {
  const { json } = run();
  assert.ok(!json.includes('Signature=zzz'));
});

test('leak check catches what scrubbing must never let through', () => {
  assert.deepEqual(findLeaks('{"a":"Bearer abcdefghijkl"}'), ['bearer']);
  assert.deepEqual(findLeaks(`{"a":"${FAKE_JWT}"}`), ['jwt']);
  assert.equal(maskContacts('appelle le +33 6 12 34 56 78 ou a@b.fr'), 'appelle le <phone> ou <email>');
  assert.deepEqual(maskContacts(['a@b.fr', 42]), ['<email>', 42]);
});

test('never touches a number: a timing with 00 in its decimals stays a number', () => {
  const masked = maskContacts({
    time: 875.8200123456789,
    wait: 0.0012345678,
    note: 'appelle le 0033612345678',
  });
  assert.equal(masked.time, 875.8200123456789);
  assert.equal(masked.wait, 0.0012345678);
  assert.equal(masked.note, 'appelle le <phone>');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(masked)));
});

test('masks what was typed in a search, in the URL, the :path header, the Referer and a server action body', () => {
  const { scrubUrl, scrubBody } = createAnonymizer('salt');
  const typed = 'https://api.example-reveal.test/conversations/model?searchParticipants=kevindu75&take=20';
  for (const url of [
    typed,
    'https://dashboard.example-reveal.test/models/123456/conversations?searchValue=kevindu75',
    '/conversations/model?q=kevindu75',
  ]) {
    const out = scrubUrl(url);
    assert.ok(!out.includes('kevindu75'), out);
  }
  assert.match(scrubUrl(typed), /take=20/);
  const body = scrubBody(
    JSON.stringify([{ DOMIdentifiers: { url: `${typed}&filter=unread` } }]),
    'text/plain',
  );
  assert.ok(!body.includes('kevindu75'), body);
  assert.ok(body.includes('filter=unread'), body);
});

test('hashes an affiliation or invitation code, keeps upper-case enums', () => {
  const { scrubValue } = createAnonymizer('salt');
  const out = scrubValue('', {
    agency: { affiliationCode: 'Q7KX2MZP4T' },
    inviteCode: 'ABC12345',
    code: 'Z9Y8X7W6',
    country: 'FR',
    status: 'PPV_SENT',
  });
  const json = JSON.stringify(out);
  for (const code of ['Q7KX2MZP4T', 'ABC12345', 'Z9Y8X7W6']) assert.ok(!json.includes(code), json);
  assert.equal(out.country, 'FR');
  assert.equal(out.status, 'PPV_SENT');
});

test('masks a pseudo in a slug, a recipient or a participants list', () => {
  const { scrubValue } = createAnonymizer('salt');
  const out = scrubValue('', {
    slug: 'kevindu75',
    to: 'kevindu75',
    fan: 'kevindu75',
    participants: ['kevindu75'],
  });
  assert.ok(!JSON.stringify(out).includes('kevindu75'), JSON.stringify(out));
});

test('refuses a forbidden word wherever it survives, without naming it', () => {
  const serialized = JSON.stringify({ url: 'https://x.test/u/KevinDu75/profile' });
  assert.deepEqual(findLeaks(serialized, ['kevindu75']), ['forbidden word #1']);
  assert.deepEqual(findLeaks(serialized, ['# comment', '']), []);
  assert.deepEqual(findLeaks(serialized), []);
});

test('decodes a JSON answer exported in base64 instead of dropping it, and hashes identifier keys', () => {
  const { anonymizeHar } = createAnonymizer('salt');
  const body = {
    counts: { 'a3f1c2d4-5b6e-4f70-8a9b-0c1d2e3f4a5b': 3 },
    data: [{ content: 'Coucou Kevin', type: 'default' }],
  };
  const har = {
    log: {
      entries: [
        {
          request: {
            method: 'GET',
            url: 'https://api.example-reveal.test/conversations/x/messages',
            headers: [],
          },
          response: {
            status: 200,
            headers: [],
            content: {
              mimeType: 'application/json',
              encoding: 'base64',
              text: Buffer.from(JSON.stringify(body)).toString('base64'),
            },
          },
        },
        {
          request: { method: 'GET', url: 'https://cdn.example-reveal.test/a.jpg', headers: [] },
          response: {
            status: 200,
            headers: [],
            content: { mimeType: 'image/jpeg', encoding: 'base64', text: 'AAAA' },
          },
        },
      ],
    },
  };
  const [json, image] = anonymizeHar(har).log.entries.map((e) => e.response.content);
  const parsed = JSON.parse(json.text);
  assert.equal(parsed.data[0].type, 'default');
  assert.equal(parsed.data[0].content, '<txt:12>');
  assert.deepEqual(Object.values(parsed.counts), [3]);
  assert.match(Object.keys(parsed.counts)[0], /^uuid_[0-9a-f]{10}$/);
  assert.equal(json.encoding, undefined);
  assert.equal(image.text, undefined);
});
