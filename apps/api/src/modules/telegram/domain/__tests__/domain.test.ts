import {
  ConversationIdSchema,
  CreatorIdSchema,
  CustomAlertIdSchema,
  INVOICE_NOT_ISSUED_REASONS,
  PayPeriodSchema,
  PlatformAccountIdSchema,
  TelegramChatIdSchema,
  TeamMemberIdSchema,
  newId,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { nextBatch, type Pending } from '../batch';
import { classify } from '../classify';
import { chatsFor, computeCoverage } from '../coverage';
import { mayRemoveChat } from '../membership';
import { describeTelegramError } from '../messages';
import { MAX_TEXT, escapeHtml, joinTexts, renderClosedBy, renderNotice } from '../render';
import { morningDigestKey, nightOf, retryDelayMs, shouldRetry } from '../schedule';
import { botIdOfToken } from '../token';

const conversationId = newId(ConversationIdSchema);

describe('classification (ADR 0020 §2)', () => {
  it('ranks a handoff urgent for the five serious causes, important otherwise', () => {
    for (const cause of ['minor', 'non_consent', 'distress', 'meeting', 'manipulation'] as const) {
      expect(classify({ kind: 'handoff', conversationId, cause })).toMatchObject({
        kind: 'notice',
        topic: 'urgent',
        threadKey: `conversation:${conversationId}`,
        link: { path: `/suivi?conversation=${conversationId}` },
      });
    }
    for (const cause of ['guard', 'budget', 'llm_unavailable', 'other', null] as const) {
      expect(classify({ kind: 'handoff', conversationId, cause })).toMatchObject({ topic: 'important' });
    }
  });

  it('sends a handoff one of her alerts caused to that alert’s topic, the important groups as a fallback', () => {
    for (const [cause, topic] of [
      ['keyword', 'keyword'],
      ['custom_alert', 'custom'],
      ['identity_doubt', 'important'],
    ] as const) {
      const notice = classify({ kind: 'handoff', conversationId, cause });
      expect(notice).toMatchObject({ kind: 'notice', topic, threadKey: `conversation:${conversationId}` });
      expect(notice?.kind === 'notice' ? notice.fallbackTopic : null).toBe(
        topic === 'important' ? undefined : 'important',
      );
    }
    expect(classify({ kind: 'handoff', conversationId, cause: 'identity_doubt' })).toMatchObject({
      body: 'Le fan doute de parler vraiment à la créatrice. Il n’écrit plus à ce fan et attend un humain.',
    });
  });

  it('names the alert of hers that paused the agent, as the history does', () => {
    const alert = { kind: 'custom', id: newId(CustomAlertIdSchema) } as const;
    const handoff = { kind: 'handoff', conversationId, cause: 'custom_alert', alert } as const;
    expect(classify(handoff, (one) => (one.id === alert.id ? 'Appel vidéo' : null))).toMatchObject({
      title: 'Important',
      body: 'Le message du fan correspond à l’alerte « Appel vidéo ». Il n’écrit plus à ce fan et attend un humain.',
    });
    // Its name not read (archived and purged, or the read failed): the generic line, the message still goes.
    expect(classify(handoff)).toMatchObject({
      body: 'Une alerte personnalisée a sonné. Il n’écrit plus à ce fan et attend un humain.',
    });
  });

  it('says an alert that only lets a human know in its topic, with nothing to close and no fan words', () => {
    const custom = newId(CustomAlertIdSchema);
    const signal = { kind: 'alert', conversationId, alert: { kind: 'custom', id: custom } } as const;
    expect(classify(signal, () => 'Appel vidéo')).toEqual({
      kind: 'notice',
      topic: 'custom',
      threadKey: null,
      title: 'Appel vidéo',
      body: 'Le message du fan correspond à l’alerte « Appel vidéo ». L’agent continue de lui répondre.',
      link: { label: 'Ouvrir la conversation', path: `/suivi?conversation=${conversationId}` },
    });
    expect(classify(signal)).toMatchObject({
      title: 'Alerte personnalisée',
      body: 'Une alerte personnalisée a sonné. L’agent continue de lui répondre.',
    });
    // The system's alerts by the label Suivi › Historique des alertes gives them.
    expect(
      classify({ kind: 'alert', conversationId, alert: { kind: 'system', code: 'service_request' } }),
    ).toMatchObject({
      topic: 'important',
      title: 'Demande de service',
      body: 'Le fan demande un service (contenu sur mesure, appel, cam, vocal) : un humain peut le lui vendre. L’agent continue de lui répondre.',
    });
    expect(
      classify({ kind: 'alert', conversationId, alert: { kind: 'system', code: 'keyword' } }),
    ).toMatchObject({ topic: 'keyword', title: 'Mot-clé de sa persona', threadKey: null });
    expect(
      classify({ kind: 'alert', conversationId, alert: { kind: 'system', code: 'identity_doubt' } }),
    ).toMatchObject({ topic: 'important', title: 'Doute sur la personne' });
  });

  it('says a silent model in the alert, without the fan’s text', () => {
    expect(classify({ kind: 'handoff', conversationId, cause: 'llm_unavailable' })).toMatchObject({
      body: 'Le modèle ne répond plus. Il n’écrit plus à ce fan et attend un humain.',
    });
  });

  it('turns a takeover into an edit of the thread, and ignores one without its conversation', () => {
    expect(classify({ kind: 'takeover', conversationId, userId: 'u1' })).toEqual({
      kind: 'closure',
      threadKey: `conversation:${conversationId}`,
      mode: 'edit',
      text: 'Pris en main',
      userId: 'u1',
    });
    expect(classify({ kind: 'takeover', conversationId: null, userId: 'u1' })).toBeNull();
  });

  it('closes the handoff alert when someone gives the conversation back to the agent', () => {
    expect(classify({ kind: 'release', conversationId, userId: 'u1' })).toEqual({
      kind: 'closure',
      threadKey: `conversation:${conversationId}`,
      mode: 'edit',
      text: 'Rendu à l’agent',
      userId: 'u1',
    });
    expect(classify({ kind: 'release', conversationId: null, userId: 'u1' })).toBeNull();
  });

  it('says the budget alert in amber and the cap reached in red', () => {
    expect(classify({ kind: 'budget', threshold: 'alert', spentMinor: 1600, capMinor: 2000 })).toMatchObject({
      topic: 'important',
      body: 'Plafond IA : 16 € sur 20 € aujourd’hui.',
    });
    const reached = classify({ kind: 'budget', threshold: 'reached', spentMinor: 2000, capMinor: 2000 });
    expect(reached).toMatchObject({ topic: 'urgent', title: 'URGENT' });
    expect(reached?.kind === 'notice' ? reached.body : '').toContain('Plafond IA atteint (20 €)');
  });

  it('says the database export is overdue, in Paris time, or has never succeeded', () => {
    expect(classify({ kind: 'backup_overdue', lastSucceededAt: new Date('2026-10-26T02:04:00Z') })).toEqual({
      kind: 'notice',
      topic: 'important',
      threadKey: null,
      title: 'Important',
      body: 'Pas de sauvegarde de la base depuis le 26 oct. à 03:04 : la copie chiffrée hors Neon a plus de 26 h.',
      link: { label: 'Ouvrir le Dashboard', path: '/' },
    });
    expect(classify({ kind: 'backup_overdue', lastSucceededAt: null })).toMatchObject({
      topic: 'important',
      body: 'Aucune sauvegarde de la base n’a encore réussi : la copie chiffrée hors Neon n’existe pas.',
    });
  });

  it('says no ECB rate came for a currency since a day, or ever, without a figure of the pay', () => {
    expect(classify({ kind: 'exchange_rate_overdue', currency: 'USD', lastRateDay: '2026-10-23' })).toEqual({
      kind: 'notice',
      topic: 'important',
      threadKey: null,
      title: 'Important',
      body: 'Pas de nouveau taux USD de la BCE depuis le 23 oct. : une quinzaine qui finit sans taux récent ne pourra pas être clôturée.',
      link: { label: 'Ouvrir le Dashboard', path: '/' },
    });
    // A calendar day, never shifted by a time zone: the 1st stays the 1st.
    const first = classify({ kind: 'exchange_rate_overdue', currency: 'USD', lastRateDay: '2026-11-01' });
    expect(first?.kind === 'notice' ? first.body : '').toContain('depuis le 1 nov. :');
    expect(classify({ kind: 'exchange_rate_overdue', currency: 'USD', lastRateDay: null })).toMatchObject({
      topic: 'important',
      body: 'Aucun taux USD de la BCE n’est encore arrivé : une quinzaine payée en USD ne peut pas être clôturée.',
    });
  });

  it('says a document of a validated statement was not issued, by period and reason, without the member nor the amount', () => {
    const period = PayPeriodSchema.parse('2026-10-16');
    expect(
      classify({ kind: 'invoice_not_issued', period, document: 'invoice', reason: 'no_mandate' }),
    ).toEqual({
      kind: 'notice',
      topic: 'important',
      threadKey: null,
      title: 'Important',
      body: 'La facture d’un relevé validé de la quinzaine du 16 au 31 oct. n’a pas été émise : le prestataire n’a pas accepté de mandat de facturation. Le relevé reste validé.',
      link: { label: 'Ouvrir la quinzaine', path: '/paie/quinzaine?quinzaine=2026-10-16' },
    });
    const credit = classify({
      kind: 'invoice_not_issued',
      period: PayPeriodSchema.parse('2027-02-01'),
      document: 'credit_note',
      reason: 'no_invoice_to_credit',
    });
    expect(credit?.kind === 'notice' ? credit.body : '').toBe(
      'Un avoir dû par la quinzaine du 1er au 15 févr. n’a pas été émis : aucune facture ne peut prendre l’avoir entier, à voir avec le comptable. Le relevé reste validé.',
    );
    // Every reason of the contract has its sentence.
    for (const reason of INVOICE_NOT_ISSUED_REASONS) {
      const notice = classify({ kind: 'invoice_not_issued', period, document: 'invoice', reason });
      expect(notice?.kind === 'notice' ? notice.body : '').not.toContain('undefined');
    }
  });

  it('says what an invoice PDF conflict means at each stage and place, by its number, without the member', () => {
    const conflict = (stage: 'render' | 'copy' | 'download', place: 'primary' | 'ovhcloud') =>
      classify({ kind: 'invoice_pdf_conflict', number: 'DEMO-2026-0001', place, stage });
    expect(conflict('render', 'primary')).toEqual({
      kind: 'notice',
      topic: 'important',
      threadKey: null,
      title: 'Important',
      body: 'Le PDF du document DEMO-2026-0001 n’a pas été enregistré : chez Hetzner, sa place est déjà prise par un autre fichier. Rien n’a été remplacé ; le document reste émis, mais ne se télécharge pas encore. À vérifier.',
      link: { label: 'Ouvrir la Paie', path: '/paie' },
    });
    const body = (stage: 'render' | 'copy' | 'download', place: 'primary' | 'ovhcloud') => {
      const notice = conflict(stage, place);
      return notice?.kind === 'notice' ? notice.body : '';
    };
    expect(body('copy', 'ovhcloud')).toBe(
      'La copie du PDF du document DEMO-2026-0001 chez OVHcloud n’est pas celle attendue (autre fichier ou autre verrou) : rien n’a été remplacé, la copie n’est pas enregistrée. Le PDF chez Hetzner n’a pas été touché. À vérifier.',
    );
    expect(body('copy', 'primary')).toBe(
      'Le PDF du document DEMO-2026-0001 manque chez Hetzner ou ne correspond plus à son empreinte : il n’a pas été copié, et aucune copie n’existe encore ; il ne se télécharge plus. À vérifier.',
    );
    // A download never claims the other place was served: it may not have been.
    expect(body('download', 'primary')).toBe(
      'Au téléchargement, le PDF du document DEMO-2026-0001 chez Hetzner manquait ou ne correspondait pas à son empreinte : ce fichier n’a pas été servi, rien n’a été remplacé. À vérifier.',
    );
    expect(body('download', 'ovhcloud')).toContain('chez OVHcloud (la copie) manquait');
  });

  it('says a document still has no PDF, or no copy, after the last attempt', () => {
    expect(classify({ kind: 'invoice_pdf_missing', number: 'DEMO-2026-0002', place: 'primary' })).toEqual({
      kind: 'notice',
      topic: 'important',
      threadKey: null,
      title: 'Important',
      body: 'Le document DEMO-2026-0002 n’a toujours pas de PDF après plusieurs essais : il reste émis, mais ne se télécharge pas encore. À vérifier.',
      link: { label: 'Ouvrir la Paie', path: '/paie' },
    });
    const copy = classify({ kind: 'invoice_pdf_missing', number: 'DEMO-2026-0002', place: 'ovhcloud' });
    expect(copy?.kind === 'notice' ? copy.body : '').toBe(
      'Le PDF du document DEMO-2026-0002 n’a pas pu être copié chez OVHcloud après plusieurs essais. Le PDF chez Hetzner n’a pas été touché. À vérifier.',
    );
  });

  it('says a document is contested, by its number and kind, without the reason nor the contractor', () => {
    expect(classify({ kind: 'invoice_contested', number: 'DEMO-2026-0003', document: 'invoice' })).toEqual({
      kind: 'notice',
      topic: 'important',
      threadKey: null,
      title: 'Important',
      body: 'La facture DEMO-2026-0003 est contestée par son prestataire. Le motif est dans la Paie, où la contestation est à juger fondée ou à refuser.',
      link: { label: 'Ouvrir la Paie', path: '/paie' },
    });
    const credit = classify({ kind: 'invoice_contested', number: 'DEMO-2026-0004', document: 'credit_note' });
    expect(credit?.kind === 'notice' ? credit.body : '').toMatch(
      /^L’avoir DEMO-2026-0004 est contesté par son prestataire\./,
    );
  });

  it('reminds a contractor’s document coming to its end, as important, by its kind and last day, never a name', () => {
    const memberId = '018f3e5c-0000-7000-8000-000000000001';
    expect(
      classify({
        kind: 'contractor_document_expiring',
        memberId,
        document: 'tax_residence',
        lastDay: '2026-12-31',
      }),
    ).toEqual({
      kind: 'notice',
      topic: 'important',
      threadKey: null,
      title: 'Important',
      body: 'L’attestation de résidence fiscale d’un prestataire couvre l’année 2026, et aucune plus récente n’est au dossier. Sans celle de 2027, ses versements à partir du 1er janvier 2027 seront bloqués.',
      link: { label: 'Ouvrir sa fiche', path: `/equipe/membres?membre=${memberId}` },
    });
    const urssaf = classify({
      kind: 'contractor_document_expiring',
      memberId,
      document: 'urssaf_vigilance',
      lastDay: '2027-03-01',
    });
    expect(urssaf?.kind === 'notice' ? urssaf.body : '').toBe(
      'L’attestation de vigilance URSSAF d’un prestataire a pour dernier jour le 1er mars 2027, et aucune plus récente n’est au dossier. Échue, ses factures partent avec un avertissement.',
    );
  });

  it('says a fresh sale in the silent sales topic: its kind, the price the fan paid and who sold it, never a fan', () => {
    const memberId = TeamMemberIdSchema.parse('018f3e5c-0000-7000-8000-000000000001');
    const sale = {
      kind: 'sale',
      saleType: 'ppv',
      currency: 'EUR',
      grossInclVatMinor: 4500,
      seller: { kind: 'member', memberId },
    } as const;
    const names = (id: string) => (id === memberId ? 'Théo' : null);
    expect(classify(sale, undefined, names)).toEqual({
      kind: 'notice',
      topic: 'sale',
      threadKey: null,
      title: 'Vente',
      body: 'PPV · 45,00\u00a0€ · vendue par Théo',
      link: null,
    });
    const bodyOf = (signal: Parameters<typeof classify>[0]): string => {
      const outcome = classify(signal, undefined, names);
      return outcome?.kind === 'notice' ? outcome.body : '';
    };
    // A name not read never holds the sale back.
    expect(classify(sale)).toMatchObject({ body: 'PPV · 45,00\u00a0€ · vendue par un chatteur' });
    expect(bodyOf({ ...sale, seller: { kind: 'agent' } })).toBe('PPV · 45,00\u00a0€ · vendue par l’agent');
    expect(bodyOf({ ...sale, seller: { kind: 'unlinked' } })).toBe('PPV · 45,00\u00a0€ · chatteur non relié');
    expect(bodyOf({ ...sale, seller: { kind: 'none' } })).toBe('PPV · 45,00\u00a0€ · sans chatteur');
    expect(bodyOf({ ...sale, saleType: 'tip', grossInclVatMinor: 1999, currency: 'USD' })).toMatch(
      /^Pourboire · 19,99\s\$US · vendue par Théo$/u,
    );
    const notice = classify(sale, undefined, names);
    if (notice?.kind !== 'notice') throw new Error('a sale is a notice');
    expect(renderNotice(notice, 'Nora', 'https://crm.example')).toEqual({
      text: '💰 <b>Vente · Nora</b>\nPPV · 45,00\u00a0€ · vendue par Théo',
      summary: 'PPV · 45,00\u00a0€ · vendue par Théo',
    });
  });

  it('says an invoice’s due date, important then urgent once overdue, with what blocks its transfer, never its amount nor a name', () => {
    const memberId = '018f3e5c-0000-7000-8000-000000000001';
    const due = {
      kind: 'invoice_due',
      overdue: false,
      memberId,
      number: 'DEMO-2026-0005',
      dueOn: '2026-12-01',
      payoutBlock: null,
    } as const;
    expect(classify(due)).toEqual({
      kind: 'notice',
      topic: 'important',
      threadKey: null,
      title: 'Important',
      body: 'La facture DEMO-2026-0005 d’un prestataire arrive à échéance le 1er décembre 2026.',
      link: { label: 'Ouvrir sa fiche', path: `/equipe/membres?membre=${memberId}` },
    });
    const bodyOf = (signal: Parameters<typeof classify>[0]): string => {
      const outcome = classify(signal);
      return outcome?.kind === 'notice' ? outcome.body : '';
    };
    expect(bodyOf({ ...due, payoutBlock: { reason: 'tax_residence_missing', year: '2027' } })).toBe(
      'La facture DEMO-2026-0005 d’un prestataire arrive à échéance le 1er décembre 2026. Son versement est bloqué : l’attestation de résidence fiscale 2027 du prestataire est absente. S’il dépasse l’échéance, des pénalités de retard et l’indemnité forfaitaire de 40 € peuvent être réclamées.',
    );
    expect(classify({ ...due, overdue: true })).toMatchObject({
      topic: 'urgent',
      fallbackTopic: 'important',
      title: 'URGENT',
    });
    expect(classify(due)).not.toHaveProperty('fallbackTopic');
    expect(bodyOf({ ...due, overdue: true })).toBe(
      'La facture DEMO-2026-0005 d’un prestataire a passé son échéance du 1er décembre 2026 sans être réglée : des pénalités de retard et l’indemnité forfaitaire de 40 € peuvent être réclamées.',
    );
    expect(
      bodyOf({ ...due, overdue: true, payoutBlock: { reason: 'documents_not_issued', year: null } }),
    ).toMatch(/Son versement est bloqué : une facture ou un avoir qu’il paie n’est pas encore émis\.$/);
    expect(bodyOf({ ...due, payoutBlock: { reason: 'tax_residence_unverified', year: '2027' } })).toMatch(
      /l’attestation de résidence fiscale 2027 du prestataire attend ta vérification\./,
    );
  });

  it('says a message could not leave, as important, in the conversation’s thread', () => {
    expect(classify({ kind: 'send_failed', conversationId })).toEqual({
      kind: 'notice',
      topic: 'important',
      threadKey: `conversation:${conversationId}`,
      title: 'Important',
      body: 'Un message de l’agent n’a pas pu partir. Il n’écrit plus à ce fan et attend un humain.',
      link: { label: 'Ouvrir la conversation', path: `/suivi?conversation=${conversationId}` },
    });
  });

  it('says why Automatique closed, rates to the tenth in French, once and as important', () => {
    const outcome = classify({
      kind: 'automatic_closed',
      missing: [{ kind: 'live_rate', value: 74.5, target: 80 }],
      conversations: 3,
    });
    expect(outcome).toMatchObject({ kind: 'notice', topic: 'important', threadKey: null });
    expect(outcome?.kind === 'notice' ? outcome.body : '').toBe(
      'Automatique refermé : l’agent est repassé en copilote sur 3 conversations. Raison : le taux en réel est à 74,5 % (objectif : 80 %).',
    );
    const changedVoice = classify({
      kind: 'automatic_closed',
      missing: [{ kind: 'decided_drafts', value: 12, target: 100 }, { kind: 'blind_test' }],
      conversations: 1,
    });
    expect(changedVoice?.kind === 'notice' ? changedVoice.body : '').toBe(
      'Automatique refermé : l’agent est repassé en copilote sur 1 conversation. Raisons : 12 brouillons décidés sur les 100 demandés ; le test à l’aveugle de cette version de la voix n’est pas validé.',
    );
    const unmeasured = classify({
      kind: 'automatic_closed',
      missing: [{ kind: 'live_rate', value: null, target: 80 }],
      conversations: 2,
    });
    expect(unmeasured?.kind === 'notice' ? unmeasured.body : '').toContain('pas encore mesuré');
    const noPersona = classify({
      kind: 'automatic_closed',
      missing: [{ kind: 'active_persona' }],
      conversations: 1,
    });
    expect(noPersona?.kind === 'notice' ? noPersona.body : '').toContain(
      'Raison : elle n’a pas de persona active.',
    );
  });

  it('tells each security alert to the urgent groups, by role and network, never a name nor a full address', () => {
    const bodyOf = (alert: Parameters<typeof classify>[0] & { kind: 'security_alert' }) => {
      const outcome = classify(alert);
      expect(outcome).toMatchObject({
        kind: 'notice',
        topic: 'urgent',
        fallbackTopic: 'important',
        threadKey: null,
        title: 'URGENT',
      });
      return outcome?.kind === 'notice' ? outcome : null;
    };
    const signIn = bodyOf({
      kind: 'security_alert',
      alert: { reason: 'new_device_sign_in', userId: 'owner-1', role: 'owner', network: '203.0.113.x' },
    });
    expect(signIn?.body).toBe(
      'Connexion au compte propriétaire depuis un appareil qui n’était pas de confiance (réseau 203.0.113.x). Si ce n’est pas le propriétaire, ferme ses sessions et change son mot de passe.',
    );
    expect(signIn?.link).toEqual({ label: 'Ouvrir la sécurité', path: '/reglages/securite' });
    expect(
      bodyOf({
        kind: 'security_alert',
        alert: {
          reason: 'sign_in_refusals',
          userId: 'op-1',
          role: 'operator',
          network: null,
          refusals: 5,
          windowMinutes: 15,
        },
      })?.body,
    ).toBe(
      '5 refus de mot de passe, de code ou de clé d’accès en 15 minutes sur un compte de l’équipe : quelqu’un essaie peut-être d’y entrer.',
    );
    expect(
      bodyOf({
        kind: 'security_alert',
        alert: { reason: 'passkey_added', userId: 'op-1', role: 'operator', network: '198.51.100.x' },
      })?.body,
    ).toBe(
      'Clé d’accès (Face ID, empreinte) ajoutée sur un compte de l’équipe (réseau 198.51.100.x). Si personne ne l’a fait, retire ses clés et ferme ses sessions.',
    );
    expect(
      bodyOf({
        kind: 'security_alert',
        alert: { reason: 'passkey_new_sign_in', userId: 'owner-1', role: 'owner', network: null },
      })?.body,
    ).toBe(
      'Connexion au compte propriétaire avec une clé d’accès jamais utilisée. Si ce n’est pas le propriétaire, retire ses clés et ferme ses sessions.',
    );
    expect(
      bodyOf({
        kind: 'security_alert',
        alert: {
          reason: 'second_factor_reset',
          userId: 'op-1',
          role: 'operator',
          network: null,
          via: 'invitation_link',
        },
      })?.body,
    ).toBe(
      'Deuxième facteur remis à zéro sur un compte de l’équipe, par un lien de réinitialisation : ses sessions et ses appareils de confiance sont fermés.',
    );
    expect(
      bodyOf({
        kind: 'security_alert',
        alert: { reason: 'persona_activated', userId: null, version: '1.2.0' },
      })?.body,
    ).toBe('Une autre version de la persona est maintenant active (1.2.0).');
    expect(
      bodyOf({
        kind: 'security_alert',
        alert: { reason: 'automatic_enabled', userId: 'op-1', scope: 'creator' },
      })?.body,
    ).toBe('Mode Automatique allumé : l’agent envoie seul sur toutes ses conversations.');
    const session = bodyOf({
      kind: 'security_alert',
      alert: {
        reason: 'platform_session_replaced',
        userId: 'op-1',
        platformAccountId: PlatformAccountIdSchema.parse('01900000-0000-7000-8000-000000000030'),
        platform: 'reveal',
      },
    });
    expect(session?.body).toBe(
      'La session Reveal de l’agent a été remplacée par une autre. Si personne de l’agence ne l’a fait, vérifie le compte branché.',
    );
    // The ids the payload carries are never shown.
    expect(JSON.stringify([signIn, session])).not.toMatch(/owner-1|op-1|01900000/u);
  });

  it('opens a thread on an expired session and closes it with a reply when it comes back', () => {
    expect(classify({ kind: 'session_expired', platformAccountId: 'acc' })).toMatchObject({
      topic: 'important',
      threadKey: 'session:acc',
    });
    expect(classify({ kind: 'session_back', platformAccountId: 'acc' })).toMatchObject({
      kind: 'closure',
      threadKey: 'session:acc',
      mode: 'reply',
    });
  });

  it('cuts the free reason of a kill switch to 200 characters', () => {
    const outcome = classify({
      kind: 'kill_switch',
      active: true,
      scope: 'global',
      scopeId: null,
      reason: 'x'.repeat(500),
    });
    expect(outcome?.kind === 'notice' ? outcome.body.length : 0).toBeLessThan(260);
    expect(
      classify({ kind: 'kill_switch', active: false, scope: 'global', scopeId: null, reason: 'fini' }),
    ).toMatchObject({
      kind: 'closure',
      threadKey: 'kill:global:global',
    });
  });
});

describe('rendering (ADR 0020 §10)', () => {
  it('escapes everything the module did not write itself', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    const rendered = renderNotice(
      {
        kind: 'notice',
        topic: 'urgent',
        threadKey: null,
        title: 'URGENT',
        body: '<b>raison</b>',
        link: { label: 'Ouvrir', path: '/suivi' },
      },
      'Démo <script>',
      'https://crm.example.test',
    );
    expect(rendered.text).toContain('🔴 <b>URGENT · Démo &lt;script&gt;</b>');
    expect(rendered.text).toContain('&lt;b&gt;raison&lt;/b&gt;');
    expect(rendered.text).toContain('<a href="https://crm.example.test/suivi">Ouvrir</a>');
    expect(rendered.summary).toBe('<b>raison</b>');
  });

  it('closes a message with the first name of who took it', () => {
    expect(renderClosedBy('texte', 'Pris en main', 'Théo')).toBe('texte\n✓ Pris en main par Théo');
    expect(renderClosedBy('texte', 'Pris en main', null)).toBe('texte\n✓ Pris en main');
    expect(renderClosedBy('texte', 'Rendu à l’agent', '<b>')).toBe('texte\n✓ Rendu à l’agent par &lt;b&gt;');
  });

  it('keeps a grouped message under Telegram’s limit and says how many are left out', () => {
    const joined = joinTexts(Array.from({ length: 10 }, (_, index) => String(index).repeat(1000)));
    expect(joined.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(joined).toMatch(/… et \d+ autres dans le CRM\.$/);
  });

  it('says identical messages of one send once, with their count on the first line', () => {
    const notice =
      '🟠 <b>Important · Nirvana</b>\nLa facture n’a pas été émise.\n<a href="https://x.test/">Ouvrir</a>';
    expect(joinTexts(['autre', notice, notice, 'autre', notice])).toBe(
      `autre (×2)\n\n🟠 <b>Important · Nirvana</b> (×3)\nLa facture n’a pas été émise.\n<a href="https://x.test/">Ouvrir</a>`,
    );
    expect(joinTexts(['a', 'b'])).toBe('a\n\nb');
    // Cut to the limit, the count left out is of messages, not of distinct texts.
    const long = (char: string) => char.repeat(3000);
    expect(joinTexts([long('a'), long('b'), long('b'), long('c')])).toMatch(
      /\n\n… et 3 autres dans le CRM\.$/,
    );
  });
});

describe('grouping a flush (ADR 0020 §8)', () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 9, 17, 22, 0, seconds));
  const item = (
    id: string,
    topic: Pending['topic'],
    action: Pending['action'] = 'send',
    seconds = 0,
  ): Pending => ({
    id,
    topic,
    action,
    text: id,
    createdAt: at(seconds),
  });

  it('sends the most serious first and never mixes a ringing message with a silent one', () => {
    const batch = nextBatch([
      item('info', 'info'),
      item('imp', 'important', 'send', 2),
      item('urg', 'urgent', 'send', 3),
    ]);
    expect(batch).toMatchObject({ kind: 'joined', isSilent: false, text: 'urg\n\nimp' });
    expect(nextBatch([item('info', 'info')])).toMatchObject({ kind: 'single', item: { id: 'info' } });
  });

  it('sends an edit alone', () => {
    expect(nextBatch([item('edit', 'urgent', 'edit'), item('urg', 'urgent', 'send', 1)])).toMatchObject({
      kind: 'single',
      item: { id: 'edit' },
    });
    expect(nextBatch([])).toBeNull();
  });
});

describe('coverage (ADR 0020 §12)', () => {
  const creator = newId(CreatorIdSchema);
  const other = newId(CreatorIdSchema);
  const groupA = newId(TelegramChatIdSchema);
  const groupB = newId(TelegramChatIdSchema);

  it('counts a route for every creator, and only groups that can be reached', () => {
    const routes = [
      { creatorId: null, topic: 'urgent' as const, chatId: groupA },
      { creatorId: creator, topic: 'urgent' as const, chatId: groupA },
      { creatorId: creator, topic: 'sale' as const, chatId: groupB },
    ];
    expect(chatsFor(routes, creator, 'urgent')).toEqual([groupA]);
    const coverage = computeCoverage(
      [
        { id: creator, displayName: 'Démo' },
        { id: other, displayName: 'Autre' },
      ],
      routes,
      [
        { id: groupA, reachable: true },
        { id: groupB, reachable: false },
      ],
    );
    expect(coverage[0]).toMatchObject({ urgentReachable: true });
    expect(coverage[0]?.topicsWithoutGroup).toContain('sale');
    expect(coverage[1]).toMatchObject({ urgentReachable: true });
    expect(
      computeCoverage([{ id: other, displayName: 'Autre' }], routes, [{ id: groupA, reachable: false }])[0],
    ).toMatchObject({
      urgentReachable: false,
    });
  });
});

describe('timing', () => {
  it('grows the retry delay and stops retrying after an hour', () => {
    expect(retryDelayMs(1)).toBe(5000);
    expect(retryDelayMs(3)).toBe(20_000);
    expect(retryDelayMs(50)).toBe(600_000);
    const created = new Date('2026-10-17T20:00:00Z');
    expect(shouldRetry(created, new Date('2026-10-17T20:59:00Z'))).toBe(true);
    expect(shouldRetry(created, new Date('2026-10-17T21:01:00Z'))).toBe(false);
  });

  it('finds the night in the creator’s time zone and the morning digest hour', () => {
    // 23:30 in Paris (UTC+2 in October): the night started at 20:00 Paris, 18:00 UTC.
    expect(nightOf('Europe/Paris', new Date('2026-10-17T21:30:00Z'))).toEqual({
      from: new Date('2026-10-17T18:00:00Z'),
      to: new Date('2026-10-17T21:30:00Z'),
    });
    // 14:00 in Paris: the last night, 20:00 to 08:00.
    expect(nightOf('Europe/Paris', new Date('2026-10-18T12:00:00Z'))).toEqual({
      from: new Date('2026-10-17T18:00:00Z'),
      to: new Date('2026-10-18T06:00:00Z'),
    });
    expect(morningDigestKey('c1', 'Europe/Paris', new Date('2026-10-18T06:10:00Z'))).toBe(
      'digest:c1:2026-10-18',
    );
    expect(morningDigestKey('c1', 'Europe/Paris', new Date('2026-10-18T07:10:00Z'))).toBeNull();
  });
});

describe('token and messages', () => {
  it('reads the bot id from a well-shaped token only', () => {
    expect(botIdOfToken(` 1234567:AA${'FAKE'.repeat(8)}00 `)).toBe('1234567');
    expect(botIdOfToken('sk-not-a-bot-token')).toBeNull();
    expect(botIdOfToken('1234567:short')).toBeNull();
  });

  it('has one French sentence per error, never a code', () => {
    expect(describeTelegramError('chat_unreachable')).toBe(
      'Le bot ne peut plus écrire dans ce groupe. Rajoute-le au groupe, puis réessaie.',
    );
    expect(describeTelegramError('unreachable')).not.toMatch(/\d{3}/);
  });
});

describe('mayRemoveChat (REG-28)', () => {
  it('lets go of a group the bot left or was banned from, never of one it sits in', () => {
    expect(mayRemoveChat('left')).toBe(true);
    expect(mayRemoveChat('kicked')).toBe(true);
    expect(mayRemoveChat('member')).toBe(false);
  });
});
