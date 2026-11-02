# CR-01 Socle de l'application installable : manifeste, service worker, notifications, clés d'accès
Statut : todo (ADR 0042 § 7 et § 8, acceptée par Charles le 02/11/2026)
Phase : espaces (ADR 0042)
Dépend de : ADR 0042, EQ-11 (shell par rôle) ; EQ-12 s'appuie sur cette fiche
Branche : task/cr-01-pwa-foundation

## Objectif
Nirvana s'installe sur l'écran d'accueil d'un téléphone, pour tous les rôles, et peut y envoyer des notifications ; les écrans du chatteur existants y sont irréprochables.

## Contexte à lire
`docs/adr/0042-creator-space.md` (§ 7, § 8), `docs/adr/0024-roles-and-navigation.md`, `apps/web/README.md`, `docs/design/README.md` (§ Finition d'un écran), `docs/conventions/security.md`, la lecture fonctionnelle d'Imperium (`/mnt/project-files/espaces/imperium-interfaces-lecture.md`, hors dépôt : concepts seulement).

## À faire
- [ ] Manifeste (nom, icône maskable faite de la flamme depuis `brand/`, `display: standalone`, portrait) et un `theme-color` par thème ; `viewport-fit=cover` dans `index.html` (sans lui, les zones sûres valent 0 sur iPhone).
- [ ] Service worker : enveloppe hors ligne ; jamais `/v1/` en cache ; conversations, fans, ventes et argent jamais dans son cache ni dans IndexedDB ; cache propre au compte, vidé à la déconnexion ; mise à jour annoncée, jamais de rechargement forcé (surtout en plein shift). Une dépendance de build éventuelle passe la quarantaine de 14 jours.
- [ ] Web Push, sans aucune saisie : le serveur crée la paire VAPID au premier démarrage et garde la clé privée chiffrée en base (`CREDENTIALS_ENCRYPTION_KEYS`, ADR 0016), jamais en configuration ni dans le dépôt ; la renouveler depuis Réglages invalide les abonnements, que chaque appareil refait à sa prochaine ouverture. Abonnement par appareil, préférences par compte, abonnements morts retirés, abonnement de l'appareil retiré à la déconnexion ; contrat Zod de l'abonnement ; module serveur et job d'envoi (propriétaire de `packages/contracts` et `packages/db`) ; la clé publique lue avant de demander l'autorisation (iOS ne demande qu'une fois).
- [ ] Heures calmes et plafond quotidien par compte (ADR 0042 § 7) dans le domaine, testés ; une notification retenue pendant les heures calmes alimente un récapitulatif à leur fin.
- [ ] Guide d'installation, page `/aide/installer` : iPhone (Partager › Sur l'écran d'accueil, nécessaire aux notifications) et Android, montré une fois, abandonné après trois refus.
- [ ] Clés d'accès (Face ID, empreinte) après la première connexion : étude du greffon de Better Auth avec le propriétaire de l'authentification, ADR si la décision engage plus que ce greffon.
- [ ] Passe téléphone sur les écrans du chatteur (Aujourd'hui, Planning, Commissions, Moi) : zone sûre, cibles de 44 px, clavier qui ne masque pas un champ, aucun défilement horizontal à 360 px.
- [ ] Registre `notification_deliveries` (clé unique membre ou compte, objet, motif) écrit dans la même transaction que la décision d'envoyer : une notification part une seule fois, même rejouée. EQ-12, CR-04 et CR-13 y branchent leurs motifs.
- [ ] Une coche faite hors ligne part avec une clé d'idempotence et l'heure de l'appareil ; le serveur décide du jour dans le fuseau de la personne et refuse une coche de plus de 48 h (ADR 0042 § 8).

## Critères d'acceptation
- Tests : heures calmes qui passent minuit, plafond quotidien, récapitulatif unique, abonnement en double sans doublon.
- Installée et vérifiée sur un iPhone (Safari) et un Android d'entrée de gamme (Chrome) : icône, ouverture plein écran, notification de test reçue.
- Lighthouse PWA sans erreur ; poids de l'enveloppe mesuré et noté.
- Finition : captures Nuit et Jour, téléphone, mouvement réduit.

## Hors périmètre
Les écrans de la créatrice (CR-02 et suivantes), les notifications de vente (CR-04), les motifs de l'équipe (annonces, prise de poste, shift non pris, rappel avant shift : EQ-12).

## Notes de session
