# 2026-10-27 — P4-01 Mots-clés d'alerte de la persona — done
Fait :
- `agent/domain/alerts.ts` : `alertKeywordsIn(text, keywords)`, en code, mots ou expressions entiers une fois normalisés (casse, accents, ponctuation), aussi avec les chiffres lus en lettres (« r0bot »).
- `readPersonaFile` rend `alertKeywords` (`notifications.alert_keywords`, sans les gabarits « <à remplir> ») ; `startDraftComposer` les passe au composeur.
- Composeur : un mot-clé dans ce qu'il a écrit depuis la dernière réponse rend un `handoff` de cause `keyword`, détail `alert_keyword`, sans appel de modèle ; un média signalé par la vision passe avant.
- Tests : `alerts.test.ts` (4), trois cas du composeur, lecture des mots-clés de la persona démo et de Messalina.
Pas fait : alertes personnalisées, `alertsSeen`, `asks_for_service`, `asks_if_bot` avec un chatteur en poste (PR B2, après le contrat de Bilan) ; écrans (Extension).
Décisions : les mots de la persona mettent en pause, comme leur contrat le dit (`PersonaNotificationsSchema`) ; seules les alertes personnalisées auront le choix `pausesAgent`.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, tests agent et playground.
