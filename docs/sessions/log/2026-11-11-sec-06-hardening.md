# 2026-11-11 — SEC-06 Durcissement : écoute locale, proxy, chaîne d'approvisionnement — done
Fait : base Docker de développement publiée sur la machine seule ; `HOST` (vide = `localhost`) pour l'API, `0.0.0.0` dans l'image ; délais et taille d'en-têtes au proxy du dashboard ; actions de la CI et images de base épinglées par empreinte, Dependabot `docker` ; `fast-uri` 3.1.9 / 4.2.3 et `seroval` 1.6.11 par `overrides` (quarantaine passée).
Pas fait : limites par adresse au proxy (il ne voit pas l'adresse du client derrière le proxy du déploiement) ; liens d'extension, limites de débit et bornes du message entrant (SEC-07).
Décisions : aucune ADR.
Découvertes : `threat-model.md` date du 16/10 et parle encore de Cloudflare Access et du jeton d'appareil ; à revoir au déploiement.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓, pnpm audit --audit-level=high ✓ ; tests d'intégration et job `images` laissés à la CI (pas de Docker dans ce conteneur).
