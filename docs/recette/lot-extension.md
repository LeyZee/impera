# Lot Extension : CRM web, application installable, design, extension Chrome

Zone : `apps/web` (shell, navigation, écrans transverses, PWA), `packages/design-system`, `apps/extension`. Le lot joue aussi la **forme** de tous les écrans des autres lots (passe visuelle), et leur signale le fond.

## 1. Shell et navigation (les cinq rails)

| # | Parcours | Attendu |
|---|---|---|
| X1 | Se connecter avec chaque rail (propriétaire, manager, chatteur, opérateur, créatrice) | onglets, ordre, barre du téléphone et accueil conformes à [inventaire.md](inventaire.md) |
| X2 | Coller chaque adresse de l'inventaire avec chaque rail | soit l'écran, soit l'accueil avec « Cette page n’est pas dans ton espace. » une seule fois ; jamais un écran vide |
| X3 | Anciennes adresses (`/reglages`, `/reglages/appareils`, `/reglages/mode`, `/moi`, `/equipe`, `/paie`, `/entrainer/corrections`, `/entrainer/tests`) | redirection sans clignotement, retour arrière qui ne boucle pas |
| X4 | Titre de l'onglet du navigateur sur chaque écran | « Écran · Section · Impera » |
| X5 | Menu du compte : apparence (Nuit, Jour, système), sécurité, notifications, installer, extension, déconnexion | chaque lien mène au bon écran selon le rôle |
| X6 | Téléphone : menu « Plus » du propriétaire et du manager ; absent chez chatteur et créatrice | conforme |
| X7 | Changement de rôle en direct (membre promu manager, suspendu, parti) pendant qu'il est connecté | rail mis à jour au prochain chargement, membre parti coupé |

## 2. Passe visuelle (tous les écrans de l'inventaire)

Pour chaque écran × rôle : Nuit et Jour, 1440 et 390 px, mouvement réduit. Captures rangées par écran. Contrôles : règles de design de Charles ([README.md](README.md), règle 6), contraste (tests du design system), aucun débordement de texte, aucun défilement horizontal sur téléphone, cibles tactiles ≥ 44 px, focus visible au clavier, tabulation dans l'ordre, Échap ferme les modales, lecteur d'écran sur les boutons sans texte.

## 3. États

| # | Parcours | Attendu |
|---|---|---|
| X8 | API coupée sur chaque écran | « Le serveur ne répond pas » seulement quand c'est vrai ; une erreur 500 n'est pas « Pas de réseau » (CREA-06 du 05/11) |
| X9 | Hors ligne puis retour en ligne | bandeau, reprise des requêtes, rien de perdu dans un formulaire |
| X10 | Session expirée (cookie retiré) | retour à la connexion, pas d'écran figé (SEC-01) |
| X11 | Listes vides, listes de 200 lignes, noms de 60 caractères, émojis, texte arabe | lisibles, rien de coupé jusqu'à disparaître (CHAT-06) |
| X12 | Double clic sur chaque bouton qui écrit | une seule écriture |

## 4. Application installable (PWA)

| # | Parcours | Attendu |
|---|---|---|
| X13 | `/aide/installer` sur Android (Chrome), iPhone (Safari, émulé), ordinateur | consignes justes par appareil |
| X14 | Service worker : mise à jour disponible, « Mettre à jour », cache vidé | bandeau de mise à jour, aucune page blanche |
| X15 | Hors ligne, l'appli installée de la créatrice | s'ouvre sur l'agenda gardé (CREA-04) |
| X16 | `/notifications` : autoriser, refuser, heures calmes, sans clés VAPID | phrase juste dans chaque cas ; les heures ne se coupent pas pendant la saisie (PRO-01) |
| X17 | Clic sur une notification | ouvre le bon écran, même appli fermée |

## 5. Écrans transverses du lot

| # | Écran | Parcours | Attendu |
|---|---|---|---|
| X18 | Moi › Préférences | changer apparence et langue | gardé après rechargement et sur un autre appareil si prévu |
| X19 | Moi › Sécurité, Réglages › Sécurité, `/compte/securite` | mot de passe, 2FA, clés d'accès, sessions, pour chaque rôle | avec Bilan (B6 à B10) |
| X20 | Créatrices : liste, recherche, nouvelle créatrice, archivées, Profil (renommer, archiver, rien supprimé, ADR 0071), Accès (inviter, révoquer) | données longues, nom pris, double clic | conforme ADR 0071 |
| X21 | Ventes de la créatrice › « Qui sont tes fans » | moins de 10 fans, 10 pile, catégorie sous 3 | seuil, « Autres », parts en % au survol, total à la dizaine (ADR 0074) |

## 6. Extension Chrome (Edge et Chrome)

Construite par `apps/extension` (sortie `.output/chrome-mv3`), chargée non empaquetée dans un navigateur de test du conteneur.

| # | Parcours | Attendu |
|---|---|---|
| X22 | Installer, ouvrir le popup sans CRM joignable, avec une adresse fausse, avec la bonne | phrase juste à chaque cas, aucune permission large demandée d'avance |
| X23 | Popup connecté avec chaque rôle | raccourcis du rail (4 au plus), session du CRM lue (ADR 0066) |
| X24 | « Relier » : coller le jeton, le révoquer dans le CRM | jeton dans le stockage local du service worker seul ; révoqué = popup le dit |
| X25 | Veille (VEI-02) sur une page HTML locale qui imite la structure attendue | relevé passif, rien ne clique ni n'écrit ; **jamais sur Instagram** |
| X26 | Onglet Reveal ouvert (page locale servie sous un hôte de test) | le popup reconnaît l'onglet ; rien n'est envoyé à l'API faute de capture de session (manque connu) |
| X27 | Mise à jour de l'extension (nouvelle version chargée) | état gardé, pas de reconnexion forcée |

Non joués lors du premier passage (06/11) : X25, qui demande un onglet `instagram.com` simulé localement ; X26 et X27, qui attendent le bac à sable sur une pile de recette et la capture de session. À reprendre avec `docs/recette/bac-a-sable.md`.

## Sans clé, à préparer

- La capture de la session du membre « bot » par l'extension n'existe pas (route `POST /v1/connector/sessions` côté API, aucun appel côté extension). À concevoir avec Bilan dès que la capture HAR dira comment Reveal authentifie : [preparation-cles.md](preparation-cles.md).
- L'enregistreur d'API de l'extension (fiche P1-01) n'est pas fait : la capture reste manuelle ([capture-reveal.md](capture-reveal.md)).
