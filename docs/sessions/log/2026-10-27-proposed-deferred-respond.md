# 2026-10-27 — Fiche proposée : réponse différée après « attends, je reviens » — done
Fait : fiche `PROPOSED-deferred-respond.md`, écrite à partir de la découverte de la seconde passe méthode / code (#209). Quand le cerveau choisit d'attendre, aucune réponse n'arrive plus tard et rien n'alerte. La fiche propose un `retryAt` borné par le code, `conversation.respond` reprogrammé sur la même clé, une seule attente, puis un message « tu es revenu ? » écrit par le moteur, qui sait déjà avoir attendu (`waited`, remarque du fil Agent), et une passation si rien ne s’écrit, et un filet de 30 minutes dans « À traiter ».
Pas fait : le code, qui attend l'ID de Charles (P3-11 proposé).
Décisions : une fiche à part plutôt qu'un ajout à P3-10, parce qu'une relance suit son silence à lui, alors qu'ici, c'est elle qui n'a pas encore répondu.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check.
