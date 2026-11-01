# Politique de vente du corpus (ID à proposer)
Statut : in_progress, ID proposé (file du coordinateur, 17/10 ; ID à valider par Charles)
Phase : 3
Dépend de : P3-06 (composeur), P0-08 (champs de persona demandés au fil plomberie), P6-01 (catalogue, pour le branchement)
Branche : claude/project-thread-e0j3ow

## Objectif
Faire porter au code les leçons chiffrées du corpus de vente (`/mnt/project-files/onlychat/corpus-vente/README.md` §3 et §4, hors dépôt) : peu d'offres, jamais après un manque d'argent avoué, jamais de mépris, de mensonge sur le payant ni de demande de photos intimes au fan, et la main à un humain sur un contenu dangereux.

## Contexte à lire
`docs/architecture/ai-engine.md` (La politique, Les gardes), `apps/api/src/modules/agent/domain/guards.ts`, `hold.ts`, `packages/llm/src/schemas.ts`, `packages/llm/prompts/brain/default.md`, la méthode de chatting (`/mnt/project-files/chatting/methode-chatting.md`, hors dépôt).

## À faire
- [x] `agent/domain/policy.ts` : `offerDecision` dit si un script peut partir maintenant (règle de Charles, 17/10 22h00) :
  - un script au plus par délai (`cooldownHours`, lu dans la persona, 10 h pour Messa, réglable par créatrice dans le CRM, champ `strategies.script_launch.cooldown_hours` de la persona, déjà dans PersonaSchema) ;
  - après le délai, seulement si le fan sexualise de nouveau ;
  - jamais sous le drapeau « budget nul » ni sur un risque ;
  - un fan qui demande lui-même du payant lève le délai et le budget nul, jamais un risque.
- [x] Gardes bloquantes :
  - demander des photos ou vidéos intimes au fan ;
  - mépris (« radin », « menteur », « mendiant ») ;
  - mensonge sur le payant (« rien à payer », « pas besoin d'argent »).
  
  Garde souple : la bouderie culpabilisante (« tu me déçois », « ça m'a refroidie »).
- [x] Cerveau : deux risques nouveaux, `dangerous_request` (L05) et `real_abuse` (L28), qui passent la main à un humain avant la voix, comme le mineur.
- [x] Évaluations L05 et L28 : le bot ne répond pas, il relaie (`evals/adversarial/dangerous-request.yaml`, `real-abuse-story.yaml`, mesurées quand Promptfoo est branché).
- [x] `offerDecision` lit les drapeaux du fan (`FanFlags`, P3-02) : « ne plus écrire », ventes gelées et âge non confirmé ferment l'offre même s'il demande ; `maySulk` interdit la bouderie sous ventes gelées, fan fragile ou « ne plus écrire ».
- [ ] Brancher `offerDecision` dans le composeur dès que les offres, les ventes et le drapeau existent (P6-01, mémoire du fan).

## Critères d'acceptation
- Tests unitaires de chaque règle : cas nominal, cas limite, cas adversarial.
- Aucune phrase du corpus dans le dépôt : les tests utilisent des exemples écrits pour l'occasion.

## Hors périmètre
Le catalogue et l'anti-doublon des packs (P6-01), l'aide au paiement (message fixe de la plateforme), l'alerte sur un fan laissé sans réponse (supervision).
