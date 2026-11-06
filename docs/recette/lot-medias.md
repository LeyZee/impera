# Lot Médias : contenu, dépôts, scripts, médiathèque, idées, agenda de la créatrice

Zone : `apps/api/src/modules/content-drops`, `media`, `scripts`, `creator-tasks`, `trends`, et leurs écrans : Contenu et Script à tourner (créatrice), Agenda de la créatrice et Créatrices › Agenda, Créatrices › Idées, Créatrices › Scripts (#614), Créatrices › Structures, Aujourd'hui de la créatrice.

Données : fichiers factices générés sur place (images unies, vidéos de quelques secondes faites par `ffmpeg`, une vidéo lourde de 2 Go en fichier creux pour l'ADR 0070), jamais une vraie photo ou vidéo.

## 1. Dépôts de contenu (ADR 0044, 0055, 0070)

| # | Parcours | Attendu |
|---|---|---|
| D1 | La créatrice dépose depuis son téléphone : photos, vidéo, vidéo lourde de tout format, catégorie, pour le feed et pour le Mass DM | ordre de sélection exact ; reprise d'un envoi coupé ; progression juste |
| D2 | Coupure réseau pendant l'envoi, appli fermée, retour | rien en double, rien de perdu |
| D3 | Fichier refusé (format inconnu, 0 octet, trop gros), stockage S3 absent | phrase claire, jamais une erreur technique |
| D4 | Demande de contenu de l'agence, réponse de la créatrice | visible des deux côtés, catégories justes |
| D5 | Effacement des originaux à leur date (`content_drops.erase_originals`) | effacés une fois, la ligne reste |

## 2. Scripts (ADR 0056, 0064, SC-02, SC-03)

| # | Parcours | Attendu |
|---|---|---|
| D6 | Structures : créer, ordonner, cartons, couleur du script | cartons dans la couleur du script |
| D7 | Demande de script (`scripts.ask_scripts`) et moment de tournage | règle « les deux » : alterner avec le dernier script demandé (Nuit après Jour, Jour après Nuit, Nuit pour le premier ; un script annulé ne compte pas) |
| D8 | Script à tourner, carton par carton, depuis le téléphone ; dépôt par carton ; reprise | ordre gardé, carton manquant signalé |
| D9 | Créatrices › Scripts côté agence (#614) : dossier rangé, export ZIP, fenêtre « Copié dans Reveal ? » | ZIP dans l'ordre, sous la taille maximale (`SCRIPT_EXPORT_MAX_BYTES`), marquage idempotent |
| D10 | Fiche à cocher étape par étape (lot suivant de SC-03) | à jouer quand elle existe |

## 3. Médiathèque (ADR 0030)

| # | Parcours | Attendu |
|---|---|---|
| D11 | Liste, filtres, vocabulaire des médias (`docs/reference/media-vocabulary.md`) | conforme |
| D12 | Média d'une créatrice demandé par une autre (ids devinés) | 403 ou 404 |

## 4. Idées et veille (ADR 0060)

| # | Parcours | Attendu |
|---|---|---|
| D13 | Créatrices › Idées : idée du jour, valider, refuser ; idée validée dans l'agenda avec sa fiche de tournage | fiche jointe (CREA-03) |
| D14 | Idée déposée par l'extension (VEI-02) depuis une page locale de démonstration | arrive dans Idées ; **jamais de test sur Instagram** |

## 5. Agenda de la créatrice (ADR 0042, CR-05)

| # | Parcours | Attendu |
|---|---|---|
| D15 | Jour, Semaine, Mois ; ajouter une tâche, une dispo, une routine ; glisser sur ordinateur, balayer sur téléphone | durées justes après minuit et aux changements d'heure (CREA-02, CREA-05) |
| D16 | Suggestion de l'agence acceptée, refusée ; rappel de tâche qui sonne | notification au bon moment, une fois |
| D17 | Hors ligne : cocher une tâche, revenir en ligne | cochée au plus 48 h après, pas de doublon |
| D18 | Créatrices › Agenda (propriétaire, manager) ; « Qui répond à tes fans » | le manager ne voit que l'agenda et les idées |
| D19 | Lien de calendrier de son téléphone | iCal valide |

## Sans clé, à préparer

- Descriptions des médias par la vision (SC-04) : clé Google. Préparer des médias factices et leurs descriptions attendues pour la première passe réelle (`pnpm probe:vision`).
- Textes de vente proposés par le modèle (SC-05) : clé xAI.
- Téléverser un script dans Reveal (SC-06), plan de publication du feed (CR-08), Mass DM (CR-11) : capture Reveal. Aujourd'hui, la fenêtre « Copié dans Reveal ? » est le seul lien, à la main.
