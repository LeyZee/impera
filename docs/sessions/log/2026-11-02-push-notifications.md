# 2026-11-02 — Les notifications push arrivent sur l'appareil (CR-01 lot b1, fil espaces)
Fait : module serveur `notifications` (clé VAPID créée et scellée par le serveur, appareils et préférences par compte sous RLS, chiffrement RFC 8291 et signature RFC 8292 sans dépendance, envoi de test), politique pure des heures calmes et du plafond, contrats Zod, abonnement côté page (`push.ts`), réception dans le service worker (`push`, `notificationclick`), écran `/notifications` (cet appareil, heures calmes, plafond) relié au menu du compte et à la feuille « Plus ».
Pas fait : registre `notification_deliveries`, politique appliquée aux envois et récapitulatif de fin d'heures calmes (lot b2) ; renouveler la clé depuis Réglages ; clés d'accès (lot c, ADR 0053) ; vérification sur un vrai iPhone et un vrai Android (après déploiement).
Décisions : aucune dépendance (pas de `web-push`) ; adresses d'envoi limitées aux services de push connus contre la falsification de requêtes côté serveur ; un appareil qui change de compte suit le compte connecté ; plafond par défaut 6 par jour, à confirmer par Charles.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, tests web (1 118), tests unitaires de l'API et des contrats, test d'intégration `notifications` sur Postgres 16 (5/5), captures téléphone et ordinateur en Nuit et Jour.
