# 2026-11-26 — INS-04 lot e : réponses aux commentaires calibrées sur ses vraies réponses

- Fiche : INS-04 (lot e), amendement du 26/11 de l'ADR 0122 sur le « go » de Charles.
- Fait : prompt `voice/instagram-comment` 1.1.0 (ses vraies réponses d'abord, suggéré jamais cru, deux emojis au plus, question seulement si le code la permet) ; `nearExamples` (cinq paires proches par proximité de texte, sans modèle) rendues dans le bloc `her_replies` du message ; `mayAsk` dans l'entrée, `mayAskQuestion` (une réponse sur trois, bornée de deux à dix) et garde `unwanted_question` ; `pnpm comment-calibration` (passage à l'aveugle sur le PC, lit son Corpus.jsonl, chiffres seuls en sortie) ; `readOnlyAdminDb` et `crmKeys` sortis de evals vers `apps/api/src/scripts/crm-read.ts`.
- Ensuite : premier calibrage fait (40 commentaires) ; prompt réglé (emojis variés, exclamations, questions) ; corrections de la créatrice sur la feuille à l'aveugle : prompt 1.2.0 (jamais d'intimité en public), `declaresLove` et garde `words_in_emoji_reply` (« je t'aime » reçoit des emojis seulement).
- Second calibrage relu sur le PC : `replyShapeOf` (emojis et « ! » de sa réponse la plus proche), prompt 1.3.0, marqueur « [pseudo] » retiré.
- Troisième calibrage : longueur ajoutée à la forme, merci court permis de revenir (`repeated_reply`).
- Reste : quatrième calibrage ; banque en base et import par le propriétaire dans le CRM ; premier calibrage (40 commentaires, accord de Charles) et réglages ; reprise de la garde d'emojis d'Agent quand elle est sur main ; refus des mots réservés aux proches en public (avec Agent).
- Découvertes : aucune.
