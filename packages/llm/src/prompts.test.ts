import { describe, expect, it } from 'vitest';

import { loadPrompt, parsePrompt, renderPrompt } from './prompts';

const SOURCE = `---
version: 1.0.0
role: voice
model_hint: grok-4.7
output_schema: VoiceOutput
---
Tu es {{name}}. {{name}} parle à {{fan}}.`;

describe('prompts', () => {
  it('parses the header and lists the variables', () => {
    const prompt = parsePrompt('voice/test', SOURCE);
    expect(prompt.header.version).toBe('1.0.0');
    expect(prompt.variables).toEqual(['name', 'fan']);
    expect(prompt.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads a Windows checkout (CRLF) as the same prompt, with the same hash', () => {
    const crlf = parsePrompt('voice/test', SOURCE.replace(/\n/g, '\r\n'));
    const lf = parsePrompt('voice/test', SOURCE);
    expect(crlf.header).toEqual(lf.header);
    expect(crlf.body).toBe(lf.body);
    expect(crlf.hash).toBe(lf.hash);
  });

  it('renders only with exactly the declared variables', () => {
    const prompt = parsePrompt('voice/test', SOURCE);
    expect(renderPrompt(prompt, { name: 'M', fan: 'F' })).toBe('Tu es M. M parle à F.');
    expect(() => renderPrompt(prompt, { name: 'M' })).toThrow(/missing \[fan\]/);
    expect(() => renderPrompt(prompt, { name: 'M', fan: 'F', price: '10' })).toThrow(/unknown \[price\]/);
  });

  it('refuses a prompt without header', () => {
    expect(() => parsePrompt('x', 'Tu es Messa.')).toThrow(/header/);
  });

  it('loads the shipped prompts', () => {
    for (const role of ['voice', 'brain', 'judge'] as const) {
      const prompt = loadPrompt(role);
      expect(prompt.header.role).toBe(role);
      expect(prompt.variables).toContain('persona_sheet');
      expect(prompt.variables).toContain('canary');
    }
    expect(loadPrompt('sense').header.role).toBe('sense');
  });

  it('puts what changes at each message last, so the stable head is cached', () => {
    const voice = loadPrompt('voice').body;
    expect(voice.indexOf('{{brief}}')).toBeGreaterThan(voice.indexOf('# Les pièges'));
    expect(voice.indexOf('{{fan_notes}}')).toBeGreaterThan(voice.indexOf('{{persona_sheet}}'));
    expect(voice.indexOf('{{situation}}')).toBeGreaterThan(voice.indexOf('# Les pièges'));
    const brain = loadPrompt('brain').body;
    expect(brain.indexOf('{{fan_notes}}')).toBeGreaterThan(brain.indexOf('# Les messages et les médias'));
    expect(brain.indexOf('{{situation}}')).toBeGreaterThan(brain.indexOf('# Les messages et les médias'));
  });
});
