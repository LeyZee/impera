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
- [ ] Filtres de VEI-01 appliqués après la génération ; aucune idée plutôt qu'une mauvaise.
- [ ] Une notification par jour au plus pour la créatrice, dans ses heures.
- [ ] Plafond de veille respecté ; ambre au plafond.
- [ ] Évals dans `evals/` avec une créatrice fictive : idées faisables, dégoûts jamais touchés, aucun chiffre inventé.

## Critères d'acceptation
- Tests contre un faux de la passerelle ; `pnpm evals` au-dessus du seuil fixé dans la fiche d'éval.

## Hors périmètre
Le profil de contenu (VEI-04).

## Notes de session
