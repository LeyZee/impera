# 2026-11-27 — Installer et relier l'extension, une seule étape (recette navigation, CH-01, CH-05, CH-06) — done

Fait : le guide `/aide/extension` n'a plus qu'une carte « Relier l'extension », après les étapes du navigateur : « à ce CRM » (seulement quand l'extension servie ne connaît pas son adresse) puis « à ton compte » (Sécurité, le code, la carte « Copilote » sur Reveal) ; le copilote ne la réexplique plus. Le bouton de Sécurité s'appelle « Relier l'extension » comme l'accueil et le guide, et le texte du code dit où le coller. Le retour du guide revient à la page d'où l'on vient (« ← Retour »), « ← Moi › Sécurité » s'il est ouvert en premier ; la page de liaison revient au guide par l'historique. L'illustration est le popup d'un chatteur sur une adresse hébergée inventée. La CI vérifie que la pile de production sert `/extension/impera.zip` comme fichier.
Pas fait : rien.
Décisions : le fichier de l'extension était déjà servi par l'image `web` (le Dockerfile copie le zip, nginx le sert) ; la recette tournait sur un serveur statique sans le zip, d'où le message. Le contrôle de CI le garde servi.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, tests du guide, de Sécurité, de l'accueil et du retour ; captures dans `recette/2026-11-27/extension-relier/` (fichiers du projet).
