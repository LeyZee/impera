import { BriefSchema } from '@impera/llm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

/**
 * The scripted AI of the recette sandbox (ADR 0075 § 3, phase 2): the fake world answers xAI's generation route the
 * way xAI does, so that the gateway, its budget, its journal and every guard run as on the day the real key arrives.
 * Every role of the gateway reaches it: the brain and the voice, the judge, and the senses through their xAI fallback.
 *
 * The answer fits the JSON schema the gateway sends with the call, built from that schema: a calm brief for the
 * brain, a short reply in her voice for the voice, middle scores for the judge, a neutral description for the senses.
 * A control route sets the next answer: a reply the guards must stop (an AI disclosure, a payment link, a meeting), a
 * risk the brain reads in his message (a suspected minor, distress…), a
 * reply out of its schema (the gateway asks once more), or a 429 (the gateway waits and asks again). It uses no token:
 * every call is journaled at 0 $, so a long recette never reaches the daily cap by accident.
 *
 * xAI's speech to text (`POST /xai/v1/stt`, the sound of a video or a voice note) answers too, with one invented
 * French sentence and a duration of 0 s, so that its call is journaled at 0 $ as well.
 */

/** What the next generation answers; each one but `neutral` is used once, then the world is neutral again. */
export const SCRIPTED_REPLIES = [
  'neutral',
  'ai_disclosure',
  'payment_link',
  'meeting',
  'off_schema',
  'rate_limited',
  'risk',
] as const;
export type ScriptedReply = (typeof SCRIPTED_REPLIES)[number];

/** The traps, in her voice: what the guards must stop before it reaches a fan. Invented (ADR 0010). */
const TRAPS: Readonly<Record<'ai_disclosure' | 'payment_link' | 'meeting', readonly string[]>> = {
  ai_disclosure: ['je suis une IA tu sais 🤖', 'mais je suis là pour toi'],
  payment_link: ['envoie-moi 20 € sur paypal.me/maya-demo 😘'],
  meeting: ['on se voit ce soir ?', 'je t’envoie mon adresse 😏'],
};

/** Calm replies in her voice, short, one emoji, each opening differently (the opening-repeat guard). */
const NEUTRAL_REPLIES: readonly (readonly string[])[] = [
  ['coucou toi 😊', 'tu fais quoi de beau ce soir ?'],
  ['hihi j’avoue 😏', 'et toi alors ?'],
  ['ah ouais ? raconte 👀'],
  ['trop mignon 🥰', 'tu me fais sourire'],
];

/** The brain's calm reading: nothing at risk, a reply to write. The policy in code decides the rest. */
const CALM_BRIEF = {
  intent: 'small_talk',
  sentiment: 'positive',
  factsProposed: [],
  kycMissing: [],
  risks: [],
  action: 'reply',
  replyBrief: 'Répondre avec chaleur et relancer la conversation par une question.',
  toneHints: ['joueuse'],
};

/** A risk the brain can read, as the gateway's own schema names it. */
const RiskSchema = BriefSchema.shape.risks.element;
type Risk = z.infer<typeof RiskSchema>;

const NextBodySchema = z.strictObject({
  reply: z.enum(SCRIPTED_REPLIES),
  /** With `risk`: the one the next brain reads in his message; a suspected minor when left out. */
  risk: RiskSchema.optional(),
});

/** What the world reads of a call: its key, and the schema the answer must fit. Anything else is left alone. */
const GenerationBodySchema = z.object({
  model: z.string().min(1),
  text: z
    .object({
      format: z.object({ type: z.string(), schema: z.record(z.string(), z.unknown()).optional() }).optional(),
    })
    .optional(),
});

/** A JSON schema node, as far as the instance builder reads it. */
const NodeSchema = z
  .object({
    $ref: z.string().optional(),
    type: z.union([z.string(), z.array(z.string())]).optional(),
    enum: z.array(z.unknown()).optional(),
    const: z.unknown().optional(),
    anyOf: z.array(z.unknown()).optional(),
    oneOf: z.array(z.unknown()).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
    items: z.unknown().optional(),
    minItems: z.number().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    exclusiveMinimum: z.number().optional(),
    exclusiveMaximum: z.number().optional(),
    format: z.string().optional(),
  })
  .loose();
type Node = z.infer<typeof NodeSchema>;

const DefinitionsSchema = z
  .object({
    $defs: z.record(z.string(), z.unknown()).optional(),
    definitions: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

/**
 * The plainest value a JSON schema accepts: its required fields only, the first of each choice, the smallest list,
 * a short French text. Enough for the gateway's own parse, which is the one that counts.
 */
export function instanceOf(schema: unknown): unknown {
  const definitions = DefinitionsSchema.safeParse(schema);
  const defs = { ...definitions.data?.definitions, ...definitions.data?.$defs };
  const build = (raw: unknown, depth: number): unknown => {
    if (depth > 20) return null;
    const parsed = NodeSchema.safeParse(raw);
    if (!parsed.success) return null;
    const node: Node = parsed.data;
    if (node.$ref !== undefined)
      return build(defs[node.$ref.replace(/^#\/(?:\$defs|definitions)\//u, '')], depth + 1);
    if ('const' in node) return node.const;
    if (node.enum !== undefined) return node.enum[0] ?? null;
    const choices = node.anyOf ?? node.oneOf;
    if (choices !== undefined) {
      // The first choice that is not null: a nullable field is filled when it can be.
      const filled = choices.find((choice) => NodeSchema.safeParse(choice).data?.type !== 'null');
      return build(filled ?? choices[0], depth + 1);
    }
    const types = typeof node.type === 'string' ? [node.type] : (node.type ?? []);
    const type = types.find((t) => t !== 'null') ?? types[0];
    switch (type) {
      case 'object': {
        const properties = node.properties ?? {};
        return Object.fromEntries(
          (node.required ?? []).map((key) => [key, build(properties[key], depth + 1)]),
        );
      }
      case 'array':
        return Array.from({ length: node.minItems ?? 0 }, () => build(node.items, depth + 1));
      case 'string': {
        if (node.format === 'date-time') return '2026-11-06T17:00:00.000Z';
        const text = 'rien à signaler'.padEnd(node.minLength ?? 0, '.');
        return node.maxLength === undefined ? text : text.slice(0, node.maxLength);
      }
      case 'number':
      case 'integer': {
        const low = node.minimum ?? node.exclusiveMinimum ?? 0;
        const high = node.maximum ?? node.exclusiveMaximum ?? low + 1;
        const middle = (low + high) / 2;
        return type === 'integer' ? Math.ceil(middle) : middle;
      }
      case 'boolean':
        return false;
      case undefined:
      default:
        return null;
    }
  };
  return build(schema, 0);
}

const propertiesOf = (schema: unknown): Readonly<Record<string, unknown>> =>
  NodeSchema.safeParse(schema).data?.properties ?? {};

type KeyFate = 'ok' | 'refused' | 'no_credit' | 'rate_limited' | 'down';

const bearerOf = (header: string | string[] | undefined): string =>
  (typeof header === 'string' ? header : '').replace(/^Bearer\s+/iu, '');

/** xAI's answer to a key that is not fine, as its verifier gets it; `null` for a fine one. */
function refused(reply: FastifyReply, fate: KeyFate): FastifyReply | null {
  if (fate === 'refused') return reply.code(401).send({ error: 'Incorrect API key provided' });
  if (fate === 'no_credit') return reply.code(403).send({ error: 'Your team has run out of credits' });
  if (fate === 'rate_limited')
    return reply.code(429).header('retry-after', '30').send({ error: 'rate limited' });
  if (fate === 'down') return reply.code(503).send({ error: 'service unavailable' });
  return null;
}

/**
 * The parts of a `multipart/form-data` body by their name, their bytes as sent (RFC 7578): enough for the two parts
 * the world reads, without a dependency the API does not need.
 */
function formParts(body: Buffer, boundary: string): Map<string, Buffer> {
  const parts = new Map<string, Buffer>();
  const delimiter = Buffer.from(`--${boundary}`);
  let at = body.indexOf(delimiter);
  while (at !== -1) {
    const start = at + delimiter.length;
    const end = body.indexOf(delimiter, start);
    if (end === -1) break;
    const part = body.subarray(start, end);
    const headersEnd = part.indexOf('\r\n\r\n');
    if (headersEnd !== -1) {
      const name = /name="([^"]*)"/u.exec(part.subarray(0, headersEnd).toString('utf8'))?.[1];
      // The part's content, without the line break that comes before the next delimiter.
      const content = part.subarray(headersEnd + 4, Math.max(headersEnd + 4, part.length - 2));
      if (name !== undefined && !parts.has(name)) parts.set(name, content);
    }
    at = end;
  }
  return parts;
}

/**
 * What a voice note or the sound of a video says in the sandbox: one calm, invented sentence (ADR 0010), always the
 * same, so that a recette reads the same transcript every time.
 */
export const SANDBOX_TRANSCRIPT = 'coucou, c’est juste un petit vocal pour te dire bonne soirée';

/**
 * Registers xAI's speech to text (`POST /xai/v1/stt`), sent as `multipart/form-data` like xAI takes it: the model's
 * name and the sound as a `file` part. Fastify knows no parser for it, so the world adds one that keeps the raw
 * bytes, split into parts by `formParts`.
 */
export function registerTranscription(app: FastifyInstance, fateOf: (key: string) => KeyFate): void {
  app.addContentTypeParser('multipart/form-data', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  app.post('/xai/v1/stt', (request, reply) => {
    if (refused(reply, fateOf(bearerOf(request.headers.authorization))) !== null) return reply;
    const type = request.headers['content-type'] ?? '';
    const raw = request.body;
    if (!type.startsWith('multipart/form-data') || !(raw instanceof Uint8Array)) {
      return reply.code(415).send({ error: 'multipart/form-data expected' });
    }
    const boundary = /boundary="?([^";]+)"?/iu.exec(type)?.[1];
    const parts = boundary === undefined ? new Map<string, Buffer>() : formParts(Buffer.from(raw), boundary);
    const file = parts.get('file');
    const model = parts.get('model')?.toString('utf8') ?? '';
    if (file === undefined || file.length === 0 || model === '') {
      return reply.code(400).send({ error: 'a model and a non-empty audio file are required' });
    }
    // The shape of xAI's answer; 0 s, so that the gateway prices the call at 0 $ (it reads this before ffprobe's).
    return { text: SANDBOX_TRANSCRIPT, language: 'fr', duration: 0 };
  });
}

/**
 * Registers the generation route of xAI (`POST /xai/v1/responses`) and its control route (`POST /__/ai/next`). Called
 * by `createWorld` before its catch-all of the AI services, which answers 503 to any route it does not know.
 */
export function registerGeneration(
  app: FastifyInstance,
  /** The fate of an xAI key, as the world decides it for the key verifier: its words, or the mode forced on xAI. */
  fateOf: (key: string) => KeyFate,
): void {
  let next: ScriptedReply = 'neutral';
  let risk: Risk = 'minor_suspected';
  let calls = 0;
  // Counted apart from the other roles, so that each reply in her voice opens differently from the one before.
  let voiceReplies = 0;

  app.post('/__/ai/next', (request, reply) => {
    const body = NextBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: `reply attendu parmi : ${SCRIPTED_REPLIES.join(', ')}` });
    }
    next = body.data.reply;
    risk = body.data.risk ?? 'minor_suspected';
    return next === 'risk' ? { prochaine: next, risque: risk } : { prochaine: next };
  });

  app.get('/__/ai', () => ({ prochaine: next, appels: calls }));

  app.post('/xai/v1/responses', (request, reply) => {
    if (refused(reply, fateOf(bearerOf(request.headers.authorization))) !== null) return reply;

    const body = GenerationBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'not a generation request' });
    calls += 1;
    const schema = body.data.text?.format?.schema;
    const properties = propertiesOf(schema);
    const isVoice = 'bubbles' in properties;
    const isBrain = 'replyBrief' in properties;

    // The call-wide scripts are used by the next call, whatever its role; a trap by the next reply in her voice.
    const scripted = next;
    if (scripted === 'rate_limited') {
      next = 'neutral';
      // A short wait, so that the gateway asks again and the second call goes through.
      return reply.code(429).header('retry-after', '1').send({ error: 'rate limited' });
    }
    let text: string;
    if (scripted === 'off_schema') {
      next = 'neutral';
      text = 'désolée, je ne sais pas répondre à ça';
    } else {
      const base = instanceOf(schema);
      let output: unknown = base;
      if (isVoice) {
        const trap = scripted === 'neutral' || scripted === 'risk' ? undefined : TRAPS[scripted];
        if (trap === undefined) voiceReplies += 1;
        else next = 'neutral';
        output = {
          bubbles: trap ?? NEUTRAL_REPLIES[voiceReplies % NEUTRAL_REPLIES.length] ?? ['coucou toi 😊'],
        };
      } else if (isBrain && typeof base === 'object' && base !== null) {
        // The brain only names the risk it reads; what it changes is the policy's, in code.
        const risks = scripted === 'risk' ? [risk] : [];
        if (scripted === 'risk') next = 'neutral';
        output = { ...base, ...CALM_BRIEF, risks };
      }
      text = JSON.stringify(output);
    }

    return {
      id: `resp_recette_${String(calls)}`,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      model: body.data.model,
      status: 'completed',
      output: [
        {
          type: 'message',
          id: `msg_recette_${String(calls)}`,
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text, annotations: [] }],
        },
      ],
      // No token: the journal writes 0 $, and the daily cap only moves when a recette asks it to (A9).
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };
  });
}
