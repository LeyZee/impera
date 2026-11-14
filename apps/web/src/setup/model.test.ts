import {
  CREATOR_SETUP_STEPS,
  CreatorIdSchema,
  MEMBER_SETUP_STEPS,
  TeamMemberIdSchema,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { creatorLines, memberLines, nextOf, progressOf } from './model';

const ANNA = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const THEO = TeamMemberIdSchema.parse('0192f3a0-0000-7000-8000-0000000000d1');

describe('« Mise en route » words', () => {
  it('names every creator step and says where it is done', () => {
    const lines = creatorLines(
      ANNA,
      CREATOR_SETUP_STEPS.map((key) => ({ key, state: 'todo' as const, note: null })),
    );
    expect(lines.every((line) => line.label.length > 0 && line.target !== null)).toBe(true);
    expect(lines.find((line) => line.key === 'persona')?.target).toEqual({
      kind: 'sheet',
      sheet: 'persona',
      creatorId: ANNA,
    });
    expect(lines.find((line) => line.key === 'agent_mode')?.target).toEqual({
      kind: 'dashboard',
      creatorId: ANNA,
    });
  });

  it('asks to launch the reliability check, and to follow the guide for the extension', () => {
    const [check] = creatorLines(ANNA, [{ key: 'reliability_check', state: 'todo', note: null }]);
    expect(check?.verb).toBe('Lancer');
    const [extension] = memberLines(THEO, [{ key: 'extension', state: 'todo', note: null }]);
    expect(extension?.verb).toBe('Le guide');
  });

  it('says the mode in force, and Telegram off', () => {
    const [mode, telegram] = creatorLines(ANNA, [
      { key: 'agent_mode', state: 'done', note: { kind: 'agent_mode', mode: 'copilot' } },
      { key: 'telegram', state: 'todo', note: { kind: 'telegram_off' } },
    ]);
    expect(mode?.hint).toBe('Copilote');
    expect(telegram?.hint).toBe('Telegram n’est pas branché : personne n’est prévenu la nuit.');
  });

  it('takes the agency’s share read at Reveal for the percentage, or asks for one of the two (ADR 0054 § 7)', () => {
    const [read, todo] = creatorLines(ANNA, [
      { key: 'agency_rate', state: 'done', note: { kind: 'share_read_on_platform' } },
      { key: 'agency_rate', state: 'todo', note: null },
    ]);
    expect(read?.label).toBe('La part de l’agence');
    expect(read?.hint).toBe('Lue chez Reveal : le pourcentage est facultatif.');
    expect(todo?.hint).toBe('Relie son compte Reveal pour la lire, ou règle le pourcentage.');
  });

  it('names every member step', () => {
    const lines = memberLines(
      THEO,
      MEMBER_SETUP_STEPS.map((key) => ({ key, state: 'done' as const, note: null })),
    );
    expect(lines.map((line) => line.hint)).toEqual([null, null, null, null, null, null, null]);
    expect(progressOf(lines)).toEqual({ done: 7, total: 7 });
    expect(nextOf(lines)).toBeUndefined();
  });

  it('puts a step to do before one that waits on someone else', () => {
    const lines = memberLines(THEO, [
      { key: 'invitation', state: 'waiting', note: null },
      { key: 'creators', state: 'todo', note: null },
    ]);
    expect(nextOf(lines)?.key).toBe('creators');
  });

  it('puts a link that died unused first', () => {
    const lines = memberLines(THEO, [
      { key: 'second_factor', state: 'todo', note: null },
      { key: 'invitation', state: 'todo', note: { kind: 'invitation_expired' } },
    ]);
    expect(nextOf(lines)?.key).toBe('invitation');
  });

  it('says what holds his first invoice and where it is settled', () => {
    const [file, agency] = memberLines(THEO, [
      { key: 'billing', state: 'todo', note: { kind: 'billing', reason: 'no_mandate' } },
      { key: 'billing', state: 'todo', note: { kind: 'billing', reason: 'agency_missing' } },
    ]);
    expect(file?.hint).toBe(
      'Sa première facture ne partirait pas : le membre n’a pas encore accepté son mandat de facturation.',
    );
    expect(file?.target).toEqual({ kind: 'file', memberId: THEO });
    expect(agency?.target).toEqual({ kind: 'page', to: '/reglages/facturation' });
    const [residence] = memberLines(THEO, [
      { key: 'billing', state: 'todo', note: { kind: 'billing', reason: 'tax_residence_missing' } },
    ]);
    expect(residence?.hint).toBe(
      'Son premier versement serait bloqué : son attestation de résidence fiscale manque.',
    );
    expect(residence?.target).toEqual({ kind: 'file', memberId: THEO });
  });

  it('asks a new link once an invitation died unused', () => {
    const [member] = memberLines(THEO, [
      { key: 'invitation', state: 'todo', note: { kind: 'invitation_expired' } },
    ]);
    expect(member).toMatchObject({
      hint: 'Son lien a expiré sans être ouvert.',
      verb: 'Nouveau lien',
      warning: true,
      target: { kind: 'anchor', id: `acces-${THEO}` },
    });
    const [creator] = creatorLines(ANNA, [
      { key: 'access', state: 'todo', note: { kind: 'invitation_expired' } },
    ]);
    expect(creator).toMatchObject({
      verb: 'Nouveau lien',
      warning: true,
      target: { kind: 'sheet', sheet: 'access', creatorId: ANNA },
    });
  });
});
