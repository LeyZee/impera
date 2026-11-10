#!/usr/bin/env node
// Anonymizes a HAR file recorded on Reveal before it leaves Charles's PC (docs/runbooks/reveal-recording.md).
//   node scripts/anonymize-har.mjs .scratch/inbox/reveal-1.har [--out <file>] [--salt-file <file>]
// Keeps the shape of the API (methods, paths, JSON keys, enums, numbers, dates, header names) and removes
// everything personal or secret: cookie and token values, free text, names, emails, phone numbers.
// Identifiers are replaced by a stable HMAC so two recordings made with the same salt can be compared.
// The salt stays on the PC (.scratch/inbox/.anon-salt by default) and is never shared.
// Refuses to write the output if a secret pattern survives (final leak check). No dependency: Node 22 only.
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_ARRAY_ITEMS = 20;
const SECRET_KEY =
  /token|secret|passw|auth(?!or(s|id|_id)?$)|session|cookie|csrf|xsrf|signature|^sig$|key|jwt|bearer|otp|nonce|affiliat|referr|invit|promo|coupon|voucher/i;
// Matched on the end of the key: `lastMessage` is free text, `messageType` is an enum.
const PERSONAL_KEY =
  /(name|user|login|handle|nick|pseudo|slug|^to|^from|^fan|participants?|recipients?|mail|phone|tel|city|ville|address|bio|text|message|body|content|caption|note|notes|description|comment|title|subject|preview|search|query|^q|^s)$/i;
// Anywhere in the key: what a person typed to find someone (`searchParticipants`, `searchValue`, `q`) is free text,
// even when it looks like an enum (a fan's pseudo is one lowercase word).
const TYPED_KEY = /search|query|keyword|term|^q$|^s$|filter(text|value)/i;
const TIME_KEY = /(at|time|date|ts|timestamp|created|updated|expires?|since|until|before|after)$/i;
const ID_KEY = /(^id$|_id$|Id$|^uuid$|_uuid$|Uuid$|^ref$|_ref$)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// Not inside a number: the `00` of `875.8200123` is not the start of a phone number.
const PHONE = /(?<![\w.])(\+|00)\d[\d .-]{7,}\d/g;
// An upper-case code with digits (`Q7KX2MZP4T`, invented): an affiliation or invitation code, not an enum like `FR` or `PPV_SENT`.
const OPAQUE_CODE = /^(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}$/;
const ENUM_LIKE = /^([a-z][a-z0-9]*([_.:-][a-z0-9]+)*|[A-Z][A-Z0-9]*(_[A-Z0-9]+)*)$/;
const SHORT_NUMBER = /^-?\d{1,5}([.,]\d{1,2})?$/;
const LONG_OPAQUE = /^[A-Za-z0-9+/_=.-]{32,}$/;
const LEAKS = [
  ['jwt', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['bearer', /Bearer\s+[A-Za-z0-9._~+/-]{8,}/i],
  ['email', /[\w.+-]+@[\w-]+\.[a-z]{2,}/i],
];

export function createAnonymizer(salt) {
  const stats = { redacted: 0, hashed: 0, texts: 0, dropped: 0, keptStrings: new Map() };

  const hash = (value) => createHmac('sha256', salt).update(String(value)).digest('hex').slice(0, 10);
  const hashId = (value) => {
    stats.hashed += 1;
    return `${UUID.test(value) ? 'uuid' : 'id'}_${hash(value)}`;
  };
  const redact = (value) => {
    stats.redacted += 1;
    return `<redacted:${String(value).length}>`;
  };
  const text = (value) => {
    stats.texts += 1;
    return `<txt:${[...value].length}>`;
  };
  // Keeps the digit count so the analysis still sees "a 9-digit id".
  const hashNumber = (value) => {
    stats.hashed += 1;
    const digits = String(Math.abs(value)).length;
    const n = Number.parseInt(hash(value), 16) % 10 ** digits;
    return Math.max(n, 10 ** (digits - 1));
  };
  const keep = (value) => {
    stats.keptStrings.set(value, (stats.keptStrings.get(value) ?? 0) + 1);
    return value;
  };

  const looksLikeTimestamp = (n) => (n >= 1e9 && n < 2.2e9) || (n >= 1e12 && n < 2.2e12);
  const isIdSegment = (s) =>
    /^\d{4,}$/.test(s) || UUID.test(s) || /^[0-9a-f]{16,}$/i.test(s) || (/\d/.test(s) && s.length >= 20);

  function scrubString(key, value) {
    if (value === '') return value;
    if (SECRET_KEY.test(key) || /^eyJ/.test(value) || /^Bearer\s/i.test(value)) return redact(value);
    if (/^https?:\/\//i.test(value) || value.startsWith('/')) return scrubUrl(value);
    if (ISO_DATE.test(value)) return value;
    if (UUID.test(value) || /^\d{6,}$/.test(value)) return hashId(value);
    if (ID_KEY.test(key) && /^[\w-]{1,64}$/.test(value)) return hashId(value);
    if (LONG_OPAQUE.test(value)) return redact(value);
    if (PERSONAL_KEY.test(key) || TYPED_KEY.test(key)) return text(value);
    if (OPAQUE_CODE.test(value)) return hashId(value);
    if (SHORT_NUMBER.test(value)) return value;
    if (value.length <= 32 && ENUM_LIKE.test(value)) return keep(value);
    return text(value);
  }

  function scrubNumber(key, value) {
    if (!Number.isInteger(value) || Math.abs(value) < 100000) return value;
    if (TIME_KEY.test(key) || looksLikeTimestamp(value)) return value;
    return hashNumber(value);
  }

  function scrubValue(key, value) {
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => scrubValue(key, item));
      if (value.length > MAX_ARRAY_ITEMS) items.push(`<+${value.length - MAX_ARRAY_ITEMS} more>`);
      return items;
    }
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          // A key can be an identifier too (`counts.<modelId>`): hashed like the value it would be.
          UUID.test(k) || /^\d{6,}$/.test(k) ? hashId(k) : k,
          SECRET_KEY.test(k) && typeof v !== 'object' ? redact(v) : scrubValue(k, v),
        ]),
      );
    }
    if (typeof value === 'string') return scrubString(key, value);
    if (typeof value === 'number') return scrubNumber(key, value);
    return value;
  }

  function scrubUrl(raw) {
    let url;
    try {
      url = new URL(raw, 'https://relative.invalid');
    } catch {
      return text(raw);
    }
    const path = url.pathname
      .split('/')
      .map((segment) => {
        const decoded = decodeURIComponent(segment);
        if (decoded === '' || !isIdSegment(decoded)) return segment;
        return `:${hashId(decoded)}`;
      })
      .join('/');
    const query = [...url.searchParams]
      .map(([k, v]) => `${k}=${encodeURIComponent(scrubParam(k, v))}`)
      .join('&');
    const origin = url.origin === 'https://relative.invalid' ? '' : url.origin;
    return `${origin}${path}${query ? `?${query}` : ''}`;
  }

  function scrubParam(key, value) {
    if (SECRET_KEY.test(key)) return redact(value);
    return String(scrubValue(key, /^\d{1,15}$/.test(value) && !ID_KEY.test(key) ? Number(value) : value));
  }

  // Bodies: JSON (possibly behind a socket.io-style numeric prefix) is scrubbed key by key; anything else is
  // reduced to its length, because HTML, scripts and media say nothing about the API.
  function scrubBody(raw, mimeType = '') {
    if (typeof raw !== 'string' || raw === '') return raw;
    if (/^\d{1,3}$/.test(raw)) return raw; // socket.io / engine.io control frames (ping, pong, ack)
    const match = /^(\d*)([[{].*)$/s.exec(raw.trim());
    if (match) {
      try {
        return match[1] + JSON.stringify(scrubValue('', JSON.parse(match[2])));
      } catch {
        // not JSON after all
      }
    }
    if (/x-www-form-urlencoded/.test(mimeType)) {
      return [...new URLSearchParams(raw)].map(([k, v]) => `${k}=${scrubParam(k, v)}`).join('&');
    }
    stats.dropped += 1;
    return `<body:${raw.length}>`;
  }

  const scrubHeaders = (headers = []) =>
    headers.map(({ name, value }) => {
      if (SECRET_KEY.test(name)) return { name, value: redact(value) };
      if (/^(referer|origin|location|:path)$/i.test(name)) return { name, value: scrubUrl(value) };
      return { name, value };
    });

  const scrubCookies = (cookies = []) =>
    cookies.map(({ name, value }) => ({ name, value: redact(value ?? '') }));

  function scrubEntry(entry) {
    const { request, response } = entry;
    const out = { ...entry };
    delete out._initiator;
    out.request = {
      ...request,
      url: scrubUrl(request.url),
      headers: scrubHeaders(request.headers),
      cookies: scrubCookies(request.cookies),
      queryString: (request.queryString ?? []).map(({ name, value }) => ({
        name,
        value: scrubParam(name, value),
      })),
    };
    if (request.postData) {
      out.request.postData = {
        mimeType: request.postData.mimeType,
        text: scrubBody(request.postData.text, request.postData.mimeType),
      };
    }
    const content = { ...(response.content ?? {}) };
    if (content.encoding === 'base64') {
      // Chrome exports some JSON answers in base64: decoded and scrubbed like the others, never dropped unread.
      const textual = /json|text|javascript|xml|x-www-form-urlencoded/i.test(content.mimeType ?? '');
      const decoded =
        textual && typeof content.text === 'string'
          ? Buffer.from(content.text, 'base64').toString('utf8')
          : null;
      delete content.encoding;
      if (decoded === null) delete content.text;
      else content.text = scrubBody(decoded, content.mimeType);
    } else if (content.text !== undefined) {
      content.text = scrubBody(content.text, content.mimeType);
    }
    out.response = {
      ...response,
      headers: scrubHeaders(response.headers),
      cookies: scrubCookies(response.cookies),
      redirectURL: response.redirectURL ? scrubUrl(response.redirectURL) : '',
      content,
    };
    if (Array.isArray(entry._webSocketMessages)) {
      out._webSocketMessages = entry._webSocketMessages.map((m) => ({ ...m, data: scrubBody(m.data) }));
    }
    return out;
  }

  function anonymizeHar(har) {
    if (!Array.isArray(har?.log?.entries)) throw new Error('Not a HAR file: log.entries is missing');
    return {
      log: {
        version: har.log.version,
        creator: har.log.creator,
        browser: har.log.browser,
        pages: (har.log.pages ?? []).map((p) => ({ ...p, title: text(p.title ?? '') })),
        entries: har.log.entries.map(scrubEntry),
      },
    };
  }

  return { anonymizeHar, scrubValue, scrubUrl, scrubBody, stats };
}

// `forbidden`: words that must never come out, whatever field carries them (the fan test's pseudo, the agency's
// codes), given on the PC only. A hit names the word's position in the list, never the word.
export function findLeaks(serialized, forbidden = []) {
  const lower = serialized.toLowerCase();
  return [
    ...LEAKS.filter(([, pattern]) => pattern.test(serialized)).map(([name]) => name),
    ...forbidden
      .map((word, i) => [word.trim().toLowerCase(), i + 1])
      .filter(([word]) => word.length >= 3 && lower.includes(word))
      .map(([, i]) => `forbidden word #${i}`),
  ];
}

// Masks emails and phone numbers that slipped into a value kept as is (header values, enums). It walks the
// strings of the parsed value, never the serialized text, so a number of the HAR (a timing) is never touched.
export function maskContacts(value) {
  if (typeof value === 'string') return value.replace(EMAIL, '<email>').replace(PHONE, '<phone>');
  if (Array.isArray(value)) return value.map(maskContacts);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskContacts(v)]));
  }
  return value;
}

function summarize(anonymized, stats) {
  const endpoints = new Map();
  let wsFrames = 0;
  for (const { request, _webSocketMessages: frames } of anonymized.log.entries) {
    const url = new URL(request.url, 'https://relative.invalid');
    const key = `${request.method} ${url.host}${url.pathname.replace(/:(uuid|id)_[0-9a-f]+/g, ':id')}`;
    endpoints.set(key, (endpoints.get(key) ?? 0) + 1);
    wsFrames += frames?.length ?? 0;
  }
  const lines = [
    `Requêtes : ${anonymized.log.entries.length}, trames WebSocket : ${wsFrames}`,
    `Valeurs masquées : ${stats.redacted} secrets, ${stats.hashed} identifiants, ${stats.texts} textes, ${stats.dropped} corps non JSON`,
    '',
    'Endpoints (méthode, hôte, chemin) :',
    ...[...endpoints].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${String(n).padStart(4)}  ${k}`),
    '',
    'Mots gardés tels quels (relis : aucun pseudo de fan ne doit y être) :',
    '  ' +
      [...stats.keptStrings]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 80)
        .map(([v]) => v)
        .join(', '),
  ];
  return lines.join('\n');
}

function main(argv) {
  const args = [...argv];
  const option = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return undefined;
    const [, value] = args.splice(i, 2);
    return value;
  };
  const outArg = option('--out');
  const saltArg = option('--salt-file');
  const forbidArg = option('--forbid-file');
  const [input] = args;
  if (!input) {
    console.error(
      'Usage : node scripts/anonymize-har.mjs <fichier.har> [--out <fichier>] [--salt-file <fichier>] [--forbid-file <fichier>]',
    );
    return 2;
  }
  const saltFile = resolve(saltArg ?? '.scratch/inbox/.anon-salt');
  if (!existsSync(saltFile)) {
    mkdirSync(dirname(saltFile), { recursive: true });
    writeFileSync(saltFile, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  const salt = readFileSync(saltFile, 'utf8').trim();
  // One word per line, on the PC only, never shared: the fan test's pseudo, the agency's affiliation code.
  const forbidFile = resolve(forbidArg ?? '.scratch/inbox/.forbid');
  const forbidden = existsSync(forbidFile)
    ? readFileSync(forbidFile, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
    : [];
  if (forbidden.length === 0) {
    console.error(
      `Attention : aucun mot interdit (${forbidFile}). Mets-y le pseudo du fan test, un par ligne.`,
    );
  }
  const out = resolve(outArg ?? input.replace(/\.har$/i, '') + '.anon.json');
  if (out === resolve(input)) {
    console.error('Refus : la sortie écraserait le fichier brut.');
    return 2;
  }

  const { anonymizeHar, stats } = createAnonymizer(salt);
  const raw = readFileSync(input, 'utf8');
  let har;
  try {
    har = JSON.parse(raw);
  } catch {
    console.error(
      `Refus : ${input} n'est pas un JSON complet (${raw.length} caractères). Fichier coupé ? Réexporte-le depuis F12.`,
    );
    return 1;
  }
  const anonymized = anonymizeHar(har);
  const serialized = JSON.stringify(maskContacts(anonymized), null, 1);
  const leaks = findLeaks(serialized, forbidden);
  if (leaks.length > 0) {
    console.error(`Refus : motif sensible encore présent (${leaks.join(', ')}). Rien n'a été écrit.`);
    return 1;
  }
  writeFileSync(out, serialized);
  console.log(summarize(anonymized, stats));
  console.log(
    `\nÉcrit : ${out}\nLe fichier .har brut reste sur ton PC : supprime-le une fois l'analyse faite.`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
