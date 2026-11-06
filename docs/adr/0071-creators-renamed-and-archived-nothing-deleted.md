# 0071. Une créatrice se renomme et s'archive, sans rien supprimer, et l'e-mail d'un accès pas encore utilisé se corrige

Statut : accepted (Charles, 05/11/2026, 20 h 22, « ok 0071 » ; recette du 05/11, constat PRO-14 et recommandation 23, validée par « go recos » : « renommer oui, archiver oui, sans rien supprimer »)
Date : 2026-11-05
Précise : l'ADR 0042 § 1 (compte de la créatrice) et l'ADR 0069 § 5 (rien ne se supprime). Ne remplace rien.

## Contexte

La recette du 05/11 (constat PRO-14, recommandation 23) a montré qu'une créatrice créée par erreur ou avec une faute de frappe reste visible partout, sans moyen de la corriger :

- `PATCH /v1/creators/:id` n'accepte que le fuseau : son nom est définitif ;
- son nom reste pris, donc une deuxième « x » est refusée ;
- aucune créatrice ne s'archive : elle reste dans les puces, les Alertes, Telegram et Sécurité ;
- « Remplacer le lien » garde l'e-mail d'origine, même si elle ne s'est jamais connectée.

Charles a validé la recommandation le 05/11 : « renommer oui, archiver oui, sans rien supprimer ».

## Décision

1. **Renommer.**
   - Seul le propriétaire renomme une créatrice. Le mot de passe lui est redemandé, comme pour le fuseau.
   - Le nouveau nom suit la même règle d'unicité (`creatorNameKey`). Un nom déjà pris est refusé, avec le message actuel.
   - Seul le nom affiché change. Son compte Reveal garde son pseudo : c’est celui de la plateforme, on ne le change pas d’ici. Sa persona garde le prénom qu'elle porte : un écart entre les deux est signalé sur sa fiche, comme à l'import (PRO-27).
   - L'ancien nom va au journal d'audit. Les écrans, les alertes et Telegram montrent le nom actuel, y compris pour le passé.
2. **Archiver.**
   - Seul le propriétaire archive, avec le mot de passe redemandé.
   - Rien n'est supprimé. Ses conversations, ventes, paies, scripts, médias et son audit restent en base, intacts. La paie déjà arrêtée reste immuable.
   - L'archivage pose une date `archived_at` sur la créatrice (migration 0118).
   - Une créatrice archivée :
     - sort des listes, des puces, des sélecteurs, des Alertes et des résumés Telegram ;
     - a l'agent arrêté, par la règle du code et pas par un réglage : aucun brouillon, aucun envoi, aucune relance ;
     - a son espace fermé : son lien encore valide est révoqué, ses sessions sont coupées, elle ne se connecte plus.
   - L'archivage est refusé tant qu'un shift est encore à venir sur elle : le propriétaire les retire d'abord dans l'agenda. Le message dit combien il en reste.
   - Les écrans d'historique (paie, ventes passées, audit) montrent toujours son nom, suivi de « archivée ».
   - Son nom reste réservé. Pour réutiliser le nom, le propriétaire renomme d'abord la créatrice archivée.
   - La page Créatrices garde une liste repliée « Archivées ». Le propriétaire peut la rouvrir de là, avec le mot de passe redemandé. L'agent reste alors éteint, et son espace se rouvre par un nouveau lien.
3. **Corriger l'e-mail d'un accès pas encore utilisé.**
   - Tant que la créatrice n'a jamais choisi de mot de passe, le propriétaire peut corriger l'e-mail de son compte.
   - Le lien en cours est révoqué, et un nouveau lien est créé pour le nouvel e-mail.
   - Dès qu'elle s'est connectée une fois, l'e-mail ne se change plus depuis la fiche. Un tel changement demandera sa propre décision.
4. **Audit.** Chaque renommage (ancien et nouveau nom), archivage, réouverture et correction d'e-mail va au journal d'audit, avec l'auteur. Le journal ne contient jamais de montant ni de donnée de fan.

## Conséquences

- Le contrat `UpdateCreatorBodySchema` accepte le nom en plus du fuseau. Un nouveau point d'entrée sert à archiver et à rouvrir, et un autre à corriger l'e-mail.
- Toutes les lectures de listes filtrent `archived_at is null`. Les lectures d'historique ne filtrent pas.
- Le moteur de l'agent ajoute « créatrice archivée » à ses gardes d'envoi, testée comme l'arrêt d'urgence.
- Le glossaire gagne « archivée ».
