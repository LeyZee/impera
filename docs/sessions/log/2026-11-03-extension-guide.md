# 2026-11-03 — Guide d'installation de l'extension dans le CRM (ADR 0067) — in progress
Fait : ADR 0067 (acceptée) ; page `/aide/extension` (apps/web/src/pwa/ExtensionPage.tsx) : à quoi sert l'extension (image du vrai popup, quatre usages dont deux « Bientôt »), téléchargement, étapes Chrome et Edge (le navigateur ouvert en premier), mise à jour ; lien « Extension » dans le menu du compte sur ordinateur, sauf pour la créatrice ; `.zip` construit par l'image du CRM (`apps/web/Dockerfile`, `zip.artifactTemplate` de WXT) et servi à `/extension/impera.zip`.
Pas fait : fiche du Chrome Web Store (compte développeur de Charles), qui remplacera le `.zip` (ADR 0067 § 3).
Décisions : rien des méthodes de l'agence ni de l'IA dans le guide ; sur le PC de développement, le guide renvoie au dossier `.output/chrome-mv3` au lieu du fichier.
Vérifié : tests de la page (navigateur détecté, lien du fichier, téléphone renvoyé à l'ordinateur) ; captures bureau et téléphone, Nuit et Jour, menu du compte : `/mnt/project-files/extension/guide-v1/`.
Relecture Extension : hors localhost, une étape donne l'adresse du CRM à coller dans le popup (bouton Copier), le `.zip` restant sans adresse (ADR 0067 § 4) ; texte de l'image Jour ; note sur les accès corrigée.
Découvertes : le popup dit « Le CRM ne répond pas » aussi quand le CRM répond mais que l'API derrière lui renvoie 502 (vu sur le PC de Charles, API arrêtée) ; un message distinct « Le CRM répond, son API non » aiderait (apps/extension, lot à part).
Candidats à suppression : aucun.
