# 2026-11-26 — INS-04 lot e : réponses aux commentaires calibrées sur ses vraies réponses

- Fiche : INS-04 (lot e), amendement du 26/11 de l'ADR 0122 sur le « go » de Charles.
- Fait : prompt `voice/instagram-comment` 1.1.0 (ses vraies réponses d'abord, suggéré jamais cru, deux emojis au plus, question seulement si le code la permet) ; `nearExamples` (cinq paires proches par proximité de texte, sans modèle) rendues dans le bloc `her_replies` du message ; `mayAsk` dans l'entrée, `mayAskQuestion` (une réponse sur trois, bornée de deux à dix) et garde `unwanted_question` ; `pnpm comment-calibration` (passage à l'aveugle sur le PC, lit son Corpus.jsonl, chiffres seuls en sortie) ; `readOnlyAdminDb` et `crmKeys` sortis de evals vers `apps/api/src/scripts/crm-read.ts`.
- Reste : banque en base et import par le propriétaire dans le CRM ; premier calibrage (40 commentaires, accord de Charles) et réglages ; reprise de la garde d'emojis d'Agent quand elle est sur main ; refus des mots réservés aux proches en public (avec Agent).
- Découvertes : aucune.
