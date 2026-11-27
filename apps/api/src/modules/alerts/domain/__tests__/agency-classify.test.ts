import {
  ConversationIdSchema,
  CreatorIdSchema,
  INVOICE_NOT_ISSUED_REASONS,
  PayPeriodSchema,
  PlatformAccountIdSchema,
  newId,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { classify } from '../agency/classify';
import { agencyMessage } from '../agency/message';

const conversationId = newId(ConversationIdSchema);

describe('agency alerts (ADR 0020 §2, kept for the owners)', () => {
  it('leaves to her tab what it tells: a safety relay, her alerts, a doubt on who she is, a custom order', () => {
    for (const cause of [
      'minor',
      'non_consent',
      'distress',
      'meeting',
      'manipulation',
      'keyword',
      'custom_alert',
      'identity_doubt',
      'custom_order',
    ] as const) {
      expect(classify({ kind: 'handoff', conversationId, cause })).toBeNull();
    }
  });

  it('tells the owners the other handoffs, as important, opening the conversation', () => {
    for (const cause of [
      'guard',
      'budget',
      'llm_unavailable',
      'other',
      'persona_inactive',
      'sale_trouble',
      null,
    ] as const) {
      expect(classify({ kind: 'handoff', conversationId, cause })).toMatchObject({
        kind: 'notice',
        topic: 'important',
        threadKey: `conversation:${conversationId}`,
        link: { path: `/suivi?conversation=${conversationId}` },
      });
    }
  });
  it('says a silent model in the alert, without the fan’s text', () => {
    expect(classify({ kind: 'handoff', conversationId, cause: 'llm_unavailable' })).toMatchObject({
      body: 'Le modèle ne répond plus. L’agent n’écrit plus à ce fan et attend un humain.',
    });
  });

  it('says a fortnight whose check no longer matches, in Important, with no amount (CRM-04 b3)', () => {
    const notice = classify({
      kind: 'sales_feed_mismatch',
      platform: 'reveal',
      from: PayPeriodSchema.parse('2026-11-01'),
      days: 3,
      accounts: 1,
    });
    expect(notice).toEqual({
      kind: 'notice',
      topic: 'important',
      threadKey: 'mismatch:reveal:2026-11-01',
      title: 'Important',
      body: 'Ventes Reveal : la vérification de la quinzaine du 1er au 15 nov. ne concorde plus avec les statistiques de Reveal, sur 3 jours et 1 compte. La paie lit toujours le net de Reveal : vérifie avant de clôturer.',
      link: { label: 'Ouvrir la vérification', path: '/reglages/ventes' },
    });
  });

  it('says a linked model gone or banned, in Important, without her name (CRM-07 a2)', () => {
    const gone = classify({
      kind: 'sales_feed_model',
      platform: 'reveal',
      change: 'gone',
      platformModelId: 'model_x',
    });
    expect(gone).toEqual({
      kind: 'notice',
      topic: 'important',
      threadKey: 'sales_feed_model:reveal:model_x:gone',
      title: 'Important',
      body: 'Ventes Reveal : une créatrice reliée n’apparaît plus dans la liste des modèles de Reveal. Rien n’est supprimé : regarde sa fiche et ses ventes.',
      link: { label: 'Ouvrir Ventes', path: '/reglages/ventes' },
    });
    expect(
      classify({
        kind: 'sales_feed_model',
        platform: 'reveal',
        change: 'banned',
        platformModelId: 'model_x',
      }),
    ).toMatchObject({
      threadKey: 'sales_feed_model:reveal:model_x:banned',
      body: 'Ventes Reveal : une créatrice reliée est marquée bannie par Reveal. Rien n’est supprimé : regarde sa fiche et ses ventes.',
    });
  });

  it('tells the owner her share strays from the percentage, once, no amount (CRM-04 d3)', () => {
    const creatorId = CreatorIdSchema.parse('018f3e5c-0000-7000-8000-0000000000c1');
    expect(
      classify({
        kind: 'agency_share_mismatch',
        creatorId,
        platform: 'reveal',
        platformAccountId: '018f3e5c-0000-7000-8000-0000000000a1',
        from: PayPeriodSchema.parse('2026-11-01'),
      }),
    ).toEqual({
      kind: 'notice',
      topic: 'important',
      oncePerThread: true,
      threadKey: 'agency_share:018f3e5c-0000-7000-8000-0000000000a1:2026-11-01',
      title: 'Important',
      body: 'Part créatrice chez Reveal : sur la quinzaine du 1er au 15 nov., elle s’écarte du pourcentage de l’agence réglé pour elle. À titre d’information.',
      link: {
        label: 'Ouvrir le pourcentage',
        path: `/creatrices?onglet=pourcentage&creatrice=${creatorId}`,
      },
    });
  });

  it('tells a change of the agency’s share at Reveal, never a share (ADR 0054 § 5)', () => {
    const creatorId = CreatorIdSchema.parse('018f3e5c-0000-7000-8000-0000000000c1');
    expect(
      classify({
        kind: 'agency_share_changed',
        creatorId,
        platform: 'reveal',
        platformAccountId: '018f3e5c-0000-7000-8000-0000000000a1',
        from: PayPeriodSchema.parse('2026-11-01'),
      }),
    ).toEqual({
      kind: 'notice',
      topic: 'important',
      oncePerThread: true,
      threadKey: 'agency_share_changed:018f3e5c-0000-7000-8000-0000000000a1:2026-11-01',
      title: 'Important',
      body: 'Part de l’agence chez Reveal : sur la quinzaine du 1er au 15 nov., elle a changé par rapport à la quinzaine d’avant. À titre d’information.',
      link: {
        label: 'Ouvrir la part de l’agence',
        path: `/creatrices?onglet=pourcentage&creatrice=${creatorId}`,
      },
    });
  });

  it('tells a créneau begun with nobody to the owners, on the planning’s clock (ADR 0094, ADR 0176)', () => {
    const creatorId = CreatorIdSchema.parse('018f3e5c-0000-7000-8000-0000000000c1');
    expect(
      classify({
        kind: 'account_uncovered',
        creatorId,
        platform: 'reveal',
        platformAccountId: '018f3e5c-0000-7000-8000-0000000000a1',
        slotStartsAt: '2026-11-20T21:30:00.000Z',
        slotEndsAt: '2026-11-21T05:00:00.000Z',
        timeZone: 'Europe/Paris',
      }),
    ).toEqual({
      kind: 'notice',
      topic: 'important',
      oncePerThread: true,
      threadKey: 'account_uncovered:018f3e5c-0000-7000-8000-0000000000a1:2026-11-20T21:30:00.000Z',
      title: 'Important',
      body: 'Compte sans personne chez Reveal : le créneau de 22 h 30 à 6 h a commencé sans chatteur, et l’IA n’est pas en Automatique. Des fans ont écrit dans les dernières 24 h.',
      link: { label: 'Ouvrir le planning', path: '/equipe/planning' },
    });
  });

  it('tells an outage per service and reason, never the key, and nothing when it is back', () => {
    expect(classify({ kind: 'connection_down', service: 'xai', reason: 'refused' })).toEqual({
      kind: 'notice',
      topic: 'important',
      threadKey: 'connection:xai',
      title: 'Important',
      body: 'La connexion xAI est en panne : la clé est refusée. Reconnecte-la. L’agent passe sur le modèle de secours, s’il est connecté.',
      link: { label: 'Ouvrir les modèles IA', path: '/reglages/modeles-ia' },
    });
    expect(classify({ kind: 'connection_down', service: 'reveal_crm', reason: 'unreachable' })).toMatchObject(
      {
        body: 'La connexion à l’API CRM de Reveal est en panne : le service ne répond plus. Les ventes ne sont plus relevées.',
        link: { label: 'Ouvrir les ventes', path: '/reglages/ventes' },
      },
    );
    // Back: nothing rings, the Dashboard says it.
    expect(classify({ kind: 'connection_back', service: 'elevenlabs' })).toBeNull();
  });

  it('rings even at night when the AI no longer reads Reveal, and says its return in silence (27/11/2026)', () => {
    expect(classify({ kind: 'connection_down', service: 'reveal_read', reason: 'format_changed' })).toEqual({
      kind: 'notice',
      topic: 'urgent',
      threadKey: 'connection:reveal_read',
      title: 'URGENT',
      body: 'Reveal a changé sa façon de répondre : l’IA ne lit plus les fans et ne leur répond plus. La lecture doit être adaptée côté Impera.',
      link: { label: 'Ouvrir le Dashboard', path: '/' },
      tag: 'connection:reveal_read',
    });
    expect(
      classify({ kind: 'connection_down', service: 'reveal_read', reason: 'session_expired' }),
    ).toMatchObject({
      topic: 'urgent',
      body: 'La session Reveal de l’IA a expiré : elle ne lit plus les fans. Dans le profil Chrome de l’IA, reconnecte le « bot », puis « Synchroniser ».',
    });
    expect(
      classify({ kind: 'connection_down', service: 'reveal_read', reason: 'unreachable' }),
    ).toMatchObject({
      topic: 'urgent',
      body: 'Reveal ne répond plus depuis plusieurs minutes : l’IA ne lit plus les fans et ne leur répond plus.',
    });
    expect(classify({ kind: 'connection_back', service: 'reveal_read' })).toMatchObject({
      topic: 'info',
      silent: true,
      tag: 'connection:reveal_read',
      body: 'La lecture de Reveal est rétablie : l’IA lit et répond de nouveau.',
    });
    const down = { kind: 'connection_down', service: 'reveal_read', reason: 'format_changed' } as const;
    const downNotice = classify(down);
    expect(downNotice === null ? null : agencyMessage(down, downNotice, null)).toMatchObject({
      title: 'Urgent · Lecture Reveal coupée',
      url: '/',
      tag: 'connection:reveal_read',
    });
    const back = { kind: 'connection_back', service: 'reveal_read' } as const;
    const backNotice = classify(back);
    // The return replaces the outage on the screen, without a sound.
    expect(backNotice === null ? null : agencyMessage(back, backNotice, null)).toEqual({
      title: 'Lecture Reveal rétablie',
      body: 'La lecture de Reveal est rétablie : l’IA lit et répond de nouveau.',
      url: '/',
      tag: 'connection:reveal_read',
      silent: true,
    });
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

  it('says AI credits run low in their own currency, urgent once under two days or empty (ADR 0091 § 4)', () => {
    const base = {
      kind: 'ai_credits_low',
      provider: 'xai',
      currency: 'USD',
      runsOutOn: '2026-11-15',
    } as const;
    expect(classify({ ...base, level: 'low', balanceMinor: 2340 })).toEqual({
      kind: 'notice',
      topic: 'important',
      threadKey: null,
      title: 'Important',
      body: 'Crédits Grok (xAI) : moins de 5 jours au rythme actuel (23,4 $ restants, épuisés vers le 15 nov.). Pense à recharger.',
      link: { label: 'Ouvrir Consommation IA', path: '/reglages/consommation-ia' },
    });
    expect(
      classify({ ...base, level: 'critical', balanceMinor: 610, provider: 'mistral', currency: 'EUR' }),
    ).toMatchObject({
      topic: 'urgent',
      title: 'URGENT',
      body: 'Crédits Mistral : moins de 2 jours au rythme actuel (6,1 € restants, épuisés vers le 15 nov.). Recharge maintenant.',
    });
    expect(classify({ ...base, level: 'empty', balanceMinor: -120, runsOutOn: null })).toMatchObject({
      topic: 'urgent',
      body: 'Crédits Grok (xAI) épuisés d’après le décompte du CRM : l’IA s’arrête sur ce service. Recharge, puis note-le dans Consommation IA.',
    });
  });

  it('says a provider refuses for lack of quota or credits, urgent, the agent on its fallback (ADR 0091 § 6)', () => {
    expect(classify({ kind: 'ai_quota_exhausted', provider: 'xai', mode: 'subscription' })).toEqual({
      kind: 'notice',
      topic: 'urgent',
      threadKey: null,
      title: 'URGENT',
      body: 'Grok (xAI) refuse les appels : le quota de ton abonnement est épuisé. L’agent répond avec son modèle de repli jusqu’à la remise à zéro du quota.',
      link: { label: 'Ouvrir Consommation IA', path: '/reglages/consommation-ia' },
    });
    expect(classify({ kind: 'ai_quota_exhausted', provider: 'mistral', mode: 'credits' })).toMatchObject({
      topic: 'urgent',
      body: 'Mistral refuse les appels faute de crédits. L’agent répond avec son modèle de repli : recharge, puis note-le dans Consommation IA.',
    });
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
      title: 'URGENT',
    });
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
      body: 'Un message de l’agent n’a pas pu partir. L’agent n’écrit plus à ce fan et attend un humain.',
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

  it('tells each security alert as urgent, by role and network, never a name nor a full address', () => {
    const bodyOf = (alert: Parameters<typeof classify>[0] & { kind: 'security_alert' }) => {
      const outcome = classify(alert);
      expect(outcome).toMatchObject({
        kind: 'notice',
        topic: 'urgent',
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
    // The owners (ADR 0096): never a name, and the notice said in hours, not as a date of some zone.
    const owner = { userId: 'owner-2', role: 'owner' as const, network: null };
    expect(
      bodyOf({ kind: 'security_alert', alert: { reason: 'owner_added', ...owner, by: 'owner-1' } })?.body,
    ).toBe(
      'Un membre de l’équipe vient de devenir propriétaire (deux au plus). Si ce n’est pas voulu, l’autre propriétaire peut demander son retrait dans Réglages › Sécurité.',
    );
    expect(
      bodyOf({
        kind: 'security_alert',
        alert: {
          reason: 'owner_removal_requested',
          ...owner,
          by: 'owner-1',
          effectiveAt: '2026-11-23T10:00:00.000Z',
        },
      })?.body,
    ).toBe(
      'Un propriétaire a demandé le retrait de l’autre : il prend effet dans 72 h. Le propriétaire visé peut l’annuler d’ici là dans Réglages › Sécurité.',
    );
    expect(
      bodyOf({ kind: 'security_alert', alert: { reason: 'owner_removal_cancelled', ...owner } })?.body,
    ).toBe('Le propriétaire visé a annulé le retrait qui attendait : il y a toujours deux propriétaires.');
    expect(
      bodyOf({
        kind: 'security_alert',
        alert: { reason: 'owner_removed', userId: 'owner-2', role: 'operator', network: null, by: 'owner-1' },
      })?.body,
    ).toBe(
      'Le préavis est passé sans annulation : un compte n’est plus propriétaire, ses sessions sont fermées.',
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

  it('cuts the free reason of a kill switch to 200 characters, and says nothing when it is lifted', () => {
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
    ).toBeNull();
  });
});
