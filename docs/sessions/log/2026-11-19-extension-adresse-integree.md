# 2026-11-19 — ADR 0067, relier l'extension depuis le CRM et adresse intégrée — done
Fait : premier amendement (la page du CRM `/extension/lier` relie l'extension en un clic, depuis le guide) ; second amendement (l'extension téléchargée depuis un CRM hébergé est construite avec son adresse : `EXTENSION_CRM_ORIGIN`, validée au chargement de la config, droit d'hôte exact dans le manifeste ; le guide de ce CRM retire l'étape « Relie-la ») ; changer d'adresse se demande (« Garder » en néon, avertissement ambre) et se voit au pied, avec « Revenir à l'adresse d'origine » ; retouches de Design sur l'accueil et la page de liaison ; tuile neutre du logo Reveal.
Pas fait : rien dans le périmètre. Le build hébergé n'est construit qu'au déploiement (non décidé).
Décisions : les deux amendements de l'ADR 0067 sont acceptés par Charles le 19/11 ; captures « adresse-integree » validées le 19/11.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests extension et web ✓, build hébergé testé (manifeste et bundle).
