# EQ-18 Journal : qui a fait quoi, lisible par le propriétaire
Statut : todo (ID validé par Charles le 27/10/2026, 15h11 : « travail sur tout ça aussi »)
Phase : équipe (ADR 0023, ADR 0024)
Dépend de : EQ-11 (shell par rôle) ; il montre ce que les autres fiches écrivent dans `audit_log`
Branche : task/eq-18-audit-journal

## Objectif
Le propriétaire retrouve en quelques secondes qui a changé un taux, validé ou payé une paie, émis un avoir, refusé un rapport ou annulé une vente, dans Réglages › Journal (ADR 0024).

## Contexte à lire
`packages/db/src/schema/tenancy.ts` (`audit_log` : ajout seul, hors RLS, lu par le propriétaire par `withAdmin`), les écritures existantes (`providers`, `persona`, `telegram`, `conversations`), ADR 0024 (§ Ce que contient chaque onglet : Réglages gagne Journal), `docs/conventions/security.md`, EQ-01 à EQ-06, EQ-10, EQ-14, EQ-15, EQ-19. Imperium avait un journal ; il n'était lisible que dans la base.

## À faire
- [ ] **Contrat** des entrées : chaque `action` a un schéma Zod de ses `details` et un libellé en français (« a changé le taux de [membre] de 10 % à 12,5 % à partir du 1er novembre »). Une action inconnue s'affiche telle quelle, jamais en erreur.
- [ ] **Ce qui n'y entre jamais** : secret, jeton, mot de passe, contenu d'un message de fan, pièce d'un dossier. Un test parcourt tous les schémas de `details` et refuse un champ de ce genre.
- [ ] **Route** réservée au propriétaire, sous `/v1/audit` : pagination par curseur sur `(created_at, id)` (UUID v7), stable quand des entrées arrivent ; filtres par membre, par type d'action (argent, équipe, accès, agent), par période ; export CSV de la sélection pour le comptable ou un litige.
- [ ] **Écran** Réglages › Journal : une ligne par geste, la plus récente en haut, avec son auteur, son heure dans le fuseau de l'agence et un lien vers l'objet (relevé, facture, membre) quand il existe ; les gestes d'argent en premier filtre. Design system, aucune durée en dur, « Le serveur ne répond pas » plutôt qu'un faux journal vide.
- [ ] **Conservation** : chaque entrée porte une catégorie (argent ou non). Ce qui touche l'argent (taux, relevés, factures, avoirs, paiements) est gardé dix ans, comme les factures ; le reste suit un délai réglable. `audit_log` est en ajout seul : la purge demande une migration qui ne l'autorise qu'à un job nommé, par `withAdmin`. Aucune entrée n'est modifiée ni supprimée à la main.

## Critères d'acceptation
- Tests : un manager et un chatteur reçoivent 403 sur `/v1/audit` ; les filtres et le curseur ne sautent ni ne répètent aucune ligne quand des entrées arrivent pendant la lecture ; l'export CSV contient exactement la sélection ; aucun `details` ne porte de secret ni de contenu de fan.
- Chaque écriture d'argent des fiches EQ-04 à EQ-06 a son libellé et son test de rendu.
- Finition (Charles, 27/10, 15h22 : « que ce soit vraiment très joli… des hovers partout… une belle hiérarchie des informations ») : chaque écran passe la barre de `docs/design/README.md` § Finition d'un écran, preuves comprises (captures Nuit et Jour, bureau et téléphone, mouvement réduit).

## Hors périmètre
Journal des conversations (`conversation_events`), traces des appels aux modèles (`llm_calls`), alertes sur le journal.

## Notes de session
