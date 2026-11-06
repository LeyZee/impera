# Inventaire des écrans d'Impera

Relevé le 06/11/2026 dans `apps/web/src/router.tsx`, `apps/web/src/shell/nav.ts` et `packages/contracts/src/rails.ts`, plus #614 et #615 (à jour après leur fusion). Chaque ligne est un écran à jouer, avec chaque rôle marqué. Un rôle non marqué doit être renvoyé chez lui (« Cette page n’est pas dans ton espace. ») et l'API doit lui répondre 403.

## Les cinq rails

Le rail dépend du compte (`railKindOf`) : `owner` = propriétaire ; `manager` = membre d'équipe à portée agence ; `chatter` = membre d'équipe ; `operator` = compte d'agence sans équipe ; `creator` = créatrice.

| Rail | Onglets (ordre) | Barre du téléphone | Accueil |
|---|---|---|---|
| Propriétaire | Dashboard · Suivi · Entraîner (Chatting) · Équipe · Paie · Créatrices (Agence) · Réglages | Dashboard, Suivi, Équipe, Paie, Plus | Dashboard |
| Manager | Dashboard · Suivi · Équipe · Paie · Créatrices · Moi | Dashboard, Suivi, Équipe, Paie, Plus | Dashboard |
| Chatteur | Aujourd'hui · Suivi · Planning · Commissions · Moi | les cinq, sans Plus | Aujourd'hui |
| Opérateur | Dashboard · Suivi · Créatrices | les trois | Dashboard |
| Créatrice | Aujourd'hui · Agenda · Ventes · Contenu · Moi | les cinq, sans Plus | Aujourd'hui |

## Hors connexion (avant le rail)

| Écran | Fichier | Ce qu'on y fait |
|---|---|---|
| Connexion | `apps/web/src/auth/SignInPage.tsx` | mot de passe, clé d'accès (passkey), erreurs, limite de tentatives |
| Second facteur | `apps/web/src/auth/SecondFactorPage.tsx` | code à 6 chiffres, code de secours, activation avec QR (ADR 0068) |
| Mot de passe oublié / nouveau | `apps/web/src/auth/ForgottenPasswordPage.tsx`, `apps/web/src/auth/NewPasswordPage.tsx` | lien par Telegram pour le propriétaire (ADR 0068), mot de passe fuité refusé |
| Lien d'invitation | `apps/web/src/auth/LinkPage.tsx`, `apps/web/src/auth/WelcomePage.tsx` | premier accès d'un membre ou d'une créatrice, lien expiré ou déjà utilisé |
| Serveur injoignable | `apps/web/src/auth/Unreachable.tsx` | API coupée, hors ligne |

## Hors rail (tous les rôles connectés)

| Adresse | Écran | Rôles |
|---|---|---|
| `/aide/installer` | Installer Impera (PWA) | tous |
| `/aide/extension` | Installer l'extension | tous sauf créatrice |
| `/notifications` | Notifications de cet appareil, heures calmes | tous |
| `/compte/securite` | Sécurité du compte (comptes sans Moi : opérateur) | opérateur |
| adresse inconnue | Page introuvable | tous |

## Écrans du rail

P = propriétaire, M = manager, C = chatteur, O = opérateur, Cr = créatrice.

| Adresse | Écran et sous-onglets | P | M | C | O | Cr | Lot |
|---|---|---|---|---|---|---|---|
| `/` | **Dashboard** : agent (mode Copilote / Automatique / Arrêt, confirmation de l'Automatique), choix de la créatrice, entonnoir, ventes, ventes lues chez Reveal, meilleurs fans, bandeau agence (budget IA), bandeau sauvegardes, bandeau papiers ; carte « Rapports de fin de shift » (#615) ; période (`?periode=`) | ✓ | ✓ | | ✓ | | Agent (cœur), Extension (écran) |
| `/aujourdhui` | **Aujourd'hui** du chatteur : shift en cours, à faire, rapport à faire, ouvrir Reveal | | | ✓ | | | Équipe + Extension |
| `/aujourdhui` | **Aujourd'hui** de la créatrice : sa journée, tâches, ce qu'on lui demande | | | | | ✓ | Médias + Extension |
| `/suivi` | **Suivi › Conversations** : liste (À toi, En attente, Rien à faire), lecteur, fiche du fan, limites du fan, désir, à apprendre, brouillon à approuver ou corriger, reprise humaine | ✓ | ✓ | ✓ (sa version, bornée au shift) | ✓ | | Agent |
| `/suivi/alertes` | **Suivi › Historique des alertes** | ✓ | ✓ | | ✓ | | Agent |
| `/entrainer/playground` | **Entraîner › Playground** : fans simulés, notes, réponses corrigées (`/entrainer/corrections` et `/entrainer/tests` y renvoient) | ✓ | | | | | Agent |
| `/planning` | **Planning** du chatteur : mes shifts, échanges, congés | | | ✓ | | | Équipe |
| `/commissions` | **Commissions › Relevés** : ses ventes, ventes retenues, palier, relevés | | | ✓ | | | Équipe |
| `/commissions/factures` | **Commissions › Factures** | | | ✓ | | | Équipe |
| `/agenda` | **Agenda** de la créatrice : Jour, Semaine (`?vue=semaine`), Mois (`?vue=mois`) ; ajouter, tâche, dispo, suggestion de l'agence, fiche de tournage | | | | | ✓ | Médias (cœur créatrice) + Extension |
| `/ventes` | **Ventes** de la créatrice : « Qui sont tes fans », gains, ventes, une conversation en lecture | | | | | ✓ | Équipe (gains) + Extension |
| `/contenu` | **Contenu** : ce qu'on lui demande, ses dépôts (feed, Mass DM), son prochain script | | | | | ✓ | Médias |
| `/contenu/script/$dropId` | **Script à tourner**, carton par carton | | | | | ✓ | Médias |
| `/equipe/planning` | **Équipe › Planning** : semaine, shifts, panneau d'un shift, échanges, lien de calendrier partagé | ✓ | ✓ | | | | Équipe |
| `/equipe/rapports` | **Équipe › Rapports** : rapports déclarés, comparaison aux totaux lus chez Reveal, validation automatique dans le seuil, blocage 48 h (#615) | ✓ | ✓ | | | | Équipe |
| `/equipe/membres` | **Équipe › Membres** : onglets Chatteurs / Managers, ajout, fiche, modifier, suspendre, départ | ✓ | ✓ | | | | Équipe |
| `/equipe/membres/$memberId/dossier` | **Dossier d'un membre** (facturation, pièces), au propriétaire seul : le manager est renvoyé à Équipe › Membres | ✓ | | | | | Équipe |
| `/paie/quinzaine` | **Paie › Quinzaine** : calcul, blocages, bandeau rapports en attente (#615), clôture, relevé | ✓ | ✓ | | | | Équipe |
| `/paie/releves` | **Paie › Historique** des relevés | ✓ | ✓ | | | | Équipe |
| `/paie/primes-malus` | **Paie › Primes et malus** | ✓ | ✓ | | | | Équipe |
| `/paie/objectifs` | **Paie › Objectifs** | ✓ | ✓ | | | | Équipe |
| `/paie/factures` | **Paie › Factures** (années, avoirs, rectificatives) | ✓ | ✓ | | | | Équipe |
| `/paie/exports` | **Paie › Exports** (comptable) | ✓ | | | | | Équipe |
| `/creatrices` | **Créatrices** : liste, nouvelle créatrice, archivées ; fiche avec les onglets Persona (Détails, Infos en plus, Elle en détail, Comportement, Stratégies, Relances, Notifications, Limites), Heures, Accès, Pourcentage, Agenda, Idées, Profil, Scripts (#614) | ✓ (tout) | ✓ (Agenda, Idées) | | ✓ (Persona) | | Agent (persona), Médias (Scripts, Idées), Équipe (Heures, Pourcentage), Extension (liste, Profil, Accès) |
| `/creatrices/structures` | **Structures** de scripts | ✓ | | | | | Médias |
| `/moi/profil` | Moi › Profil | | ✓ | ✓ | | | Équipe + Extension |
| `/moi/dossier` | Moi › Dossier (facturation, pièces, guide Bénin) | | ✓ | ✓ | | | Équipe |
| `/moi/factures` | Moi › Factures | | ✓ | | | | Équipe |
| `/moi/calendrier` | Moi › Calendrier (lien iCal) | | ✓ | ✓ | | | Équipe |
| `/moi/persona` | Moi › Persona (sa fiche, sans l'IA ni les réglages de l'agence) | | | | | ✓ | Agent |
| `/moi/securite` | Moi › Sécurité (mot de passe, second facteur, clés d'accès, sessions) | | ✓ | ✓ | | ✓ | Bilan + Extension |
| `/moi/preferences` | Moi › Préférences (apparence, langue) | | ✓ | ✓ | | ✓ | Extension |
| `/reglages/modeles-ia` | Réglages › Modèles IA (Services : xAI, Google, Mistral, ElevenLabs) | ✓ | | | | | Bilan |
| `/reglages/ventes` | Réglages › Ventes : clé CRM Reveal, liens des modèles et des chatteurs, webhook, vérification, import des créatrices, badge « N nouvelles » | ✓ | | | | | Bilan |
| `/reglages/alertes` | Réglages › Alertes | ✓ | | | | | Agent |
| `/reglages/telegram` | Réglages › Telegram : Qui est prévenu, Ventes, Validations, Bots et groupes, Mon chat privé | ✓ | | | | | Bilan |
| `/reglages/regles-de-paie` | Réglages › Règles de paie (minimum de versement, délai) | ✓ | | | | | Équipe |
| `/reglages/facturation` | Réglages › Facturation (régimes, mentions légales) | ✓ | | | | | Équipe |
| `/reglages/sauvegardes` | Réglages › Sauvegardes (lancer, test de restauration) | ✓ | | | | | Bilan |
| `/reglages/securite` | Réglages › Sécurité (comptes, second facteur, sessions) | ✓ | | | | | Bilan |

Anciennes adresses qui doivent rediriger sans erreur : `/reglages` → Modèles IA, `/reglages/appareils` et `/reglages/mode` → Réglages, `/moi` → Profil ou Persona, `/equipe` et `/paie` → leur premier onglet.

## Extension Chrome

| Entrée | Fichier | Ce qu'on y fait |
|---|---|---|
| Popup | `apps/extension/src/entrypoints/popup/view.ts` | adresse du CRM, état de la session CRM (ADR 0066), raccourcis du rail (4 au plus), « Relier » |
| Veille | `apps/extension/src/entrypoints/popup/watch-view.ts`, `apps/extension/src/entrypoints/watch.ts` | relevé passif (VEI-02, ADR 0060) : à tester seulement sur des pages de démonstration locales, jamais sur Instagram |
| Service worker | `apps/extension/src/entrypoints/background.ts` | jeton dans le stockage local, révocation depuis le CRM |
| Installation | `/aide/extension` (CRM) | ADR 0067 |

## Workflows de bout en bout

Les parcours qui traversent plusieurs zones sont dans [parcours-transverses.md](parcours-transverses.md). Ceux d'une seule zone sont dans le lot de la zone.
