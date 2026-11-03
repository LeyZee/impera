# VEI-03 Le job du matin : signaux de Grok et idées du jour
Statut : blocked (clé xAI)
Phase : veille (ADR 0060)
Dépend de : VEI-01, P3-01 (passerelle LLM)
Branche : task/vei-03-morning-ideas
Propriétaire : Agent (prompts, génération, évals)

## Objectif
Chaque matin, Grok rend des signaux sourcés pour toute l'agence, puis au plus trois idées par créatrice passent les filtres du code et arrivent dans « Idées du jour ».

## Contexte à lire
ADR 0060 § 2 (source 2), § 4, § 6 et § 7, ADR 0009, ADR 0042 § 5 (aucun chiffre non reçu), méthode de chatting (`/mnt/project-files/chatting/`, hors dépôt) pour « jamais de nu » en public.

## À faire
- [ ] Job quotidien des signaux (recherche X et web de Grok), une fois pour l'agence, schéma Zod, sources gardées, péremption.
- [ ] Job du matin par créatrice (7 h dans son fuseau), rejouable : signaux vivants, profil validé, persona, idées des 30 jours, résultats des idées passées ; prompt versionné ; au plus 3 idées.
- [ ] Description par la vision des captures d'un post marqué (ADR 0060 § 2, source 6) : schéma Zod (accroche, angles, texte à l'écran, montage estimé, compréhensible sans le son), captures effacées dès la réponse, test qui le vérifie.
- [ ] Sortie « Post du jour + hack » (grille acceptée par Charles le 03/11, 12 h 45 ; tout est rempli par l'IA, l'humain ne fait que marquer), deux rendus : agence et créatrice. Les 12 points du schéma :
  1. pourquoi c'est un signal (calculé par le code : vues comparées à la moyenne du compte, vues / abonnés) ;
  2. accroche des 2 premières secondes (vision) ;
  3. pattern interrupt (vision) ;
  4. compréhensible sans le son (vision) ;
  5. texte à l'écran, et sa version dans la voix de la créatrice ;
  6. le son : tendance (vu sur plusieurs posts relevés) ou original ; tendance → Reel en mode assisté (ADR 0057 § 5) ;
  7. atout mis en avant : celui du profil de contenu validé, jamais deviné par la vision ; jusqu'où aller sur Instagram ;
  8. montage : angles, cuts estimés, durée lue dans la page, boucle ;
  9. difficulté sur 10, temps de tournage, matériel ;
  10. transposition pour elle : décor, tenue, accessoire, sa touche (profil et persona) ;
  11. pourquoi ça pourrait rater pour elle (style, dégoût filtré, trop suggestif pour Instagram, tendance vieillissante) ;
  12. déclinaisons d'un même tournage (Reel, story, feed Reveal) et ce qu'on regarde à 48 h.
  Jamais d'appel à l'action vers Reveal dans un Reel Instagram (ADR 0057 § 6). La fiche de la créatrice est courte, positive, sans chiffre de vente ni IA visible : difficulté, durée, pourquoi en une ligne, plans numérotés à la seconde, tenue, décor, texte à l'écran, son à ajouter, bonus feed Reveal.
- [ ] Filtres de VEI-01 appliqués après la génération ; aucune idée plutôt qu'une mauvaise.
- [ ] Une notification par jour au plus pour la créatrice, dans ses heures.
- [ ] Plafond de veille respecté ; ambre au plafond.
- [ ] Évals dans `evals/` avec une créatrice fictive : idées faisables, dégoûts jamais touchés, aucun chiffre inventé.

## Critères d'acceptation
- Tests contre un faux de la passerelle ; `pnpm evals` au-dessus du seuil fixé dans la fiche d'éval.

## Hors périmètre
Le profil de contenu (VEI-04).

## Notes de session
