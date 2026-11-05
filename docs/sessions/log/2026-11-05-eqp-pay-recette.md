# 2026-11-05 — Recette EQP-05, 06, 13, 16, 17 : la paie dit ce qu'elle sait — done

Fait :

- EQP-05 : sans les réglages de l'agence (`/v1/scheduling/settings` muet), Quinzaine, Primes et malus, Objectifs, Commissions et Factures disent « Le serveur ne répond pas : la quinzaine en cours n'a pas pu être lue. » avec « Réessayer », au lieu d'un chargement sans fin. Exports et Moi › Factures disent la même chose de « l'heure de l'agence » (`useAgencySettingsDown`).
- EQP-06 : la ligne d'un relevé nomme chaque montant de son total, dans l'ordre du moteur : commission, part d'équipe, palier, objectif d'équipe, prime(s), malus, report(s) reçu(s), ajustement(s). La ligne s'additionne donc jusqu'au montant à verser (`memberFacts`).
- EQP-13 :
  - une quinzaine finie l'est « depuis le dimanche 1er novembre à 0 h », plus « le samedi 31 octobre à minuit » ;
  - une période dans une phrase se dit « du 16 au 31 octobre 2026 » (`periodLine(period, true)`), plus « du 16 – 31 octobre 2026 » : factures, avoirs, exports et report d'une quinzaine dans Commissions ;
  - « vs » devient « par rapport à la quinzaine du 1er au 15 octobre ». Sans relevé avant, le relevé dit « nouveau : rien sur la quinzaine du 1er au 15 octobre ».
- EQP-16 : quand la clôture valide moins de relevés que la quinzaine n'en compte, le dialogue dit « À verser pour l'équipe » (tous les relevés) puis « Ce relevé » (ou « Ces N relevés ») et ce qu'il verse. Quand il valide tout, il garde une seule ligne « À verser ».
- EQP-17 : un membre parti porte une pastille neutre « Parti » à côté de son nom dans Paie › Quinzaine et dans Équipe › Rapports › Quinzaine (`PayMember.left`).

Pas fait : la phrase du relevé final d'un membre parti (EQP-17, question de paie 2), qui attend la réponse de Charles.

Décisions :
- « Parti » est neutre, pas ambre : ce n'est pas une alerte, c'est un fait qui change la lecture de la ligne ;
- « 0 h » plutôt que « minuit » : « minuit » du 31 se lit des deux côtés de la journée.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié :
- `pnpm check` ;
- unitaires web : `payroll/model` (détail du total), `invoices/model`, `PeriodPage` (serveur muet, fin de quinzaine, comparaison, clôture d'un relevé, « Parti »), `ReportsPage` (« Parti »), `CommissionsPage`, `ExportsPage`, `InvoicesPage` ;
- captures Nuit et Jour, téléphone et ordinateur : `recette/2026-11-05/corrections/equipe/paie/` dans les fichiers du projet.
