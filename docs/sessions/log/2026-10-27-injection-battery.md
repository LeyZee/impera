# 2026-10-27 — Pièges : une vraie batterie de tests d'injection — done

Fait : `agent/domain/injection.ts` lit les pièges en espagnol, italien, allemand et portugais en plus du français et de l'anglais, et lit chaque message décodé (base64, échappements `%69` `&#105;` `i`, lettres espacées ou pointées, à l'envers, ROT13). `detectInjectionAcross` voit un piège coupé sur ses trois derniers messages, seulement quand le message courant le complète. `assessTrap` lit tout ce que la vision a écrit d'un média (description, décor, segments en plus du texte lu et de la transcription). `screenNotes` retire des notes du fan les lignes en forme d'ordre avant le prompt, `withoutOrders` empêche le brouillon et le playground de proposer un tel fait. Une note écartée laisse une trace : un `warn` « fan notes shaped like an order kept out of the prompt » avec le nombre et la conversation, jamais le texte (une ligne dans `composition-root.ts`, accord de Bilan). La règle anglaise « you are now » ne vise plus que « you are now an AI / assistant… » (« you are now my favourite girl » passait pour un piège). Tests : 5 cas avant, une batterie par vecteur (langues, encodages, messages coupés, médias, notes et faits) et des messages ordinaires qui restent propres sous toutes les lectures.

Pas fait : `conversations/application/facts.ts` (Bilan) ne filtre pas lui-même les faits ; le filtre est en amont, dans l'agent.

Décisions : aucune.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`.
