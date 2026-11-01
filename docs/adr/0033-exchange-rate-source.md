# 0033. Paie : le taux dollar → euro vient de la BCE, lu chaque heure par un job

Statut : accepted (Charles, 28/10/2026 17h23, « et ok 0033 »)
Date : 2026-10-28
Complète : ADR 0023 § Paie (le taux de change) et ADR 0032 (les taux de la clôture)

## Contexte

Un compte payé en dollars est converti en euros dans le relevé de paie. Les règles sont déjà posées :

- ADR 0023 : le taux est un entier mis à l'échelle (`rate_micros`, des euros pour une unité de la devise, en millionièmes), copié dans le relevé avec sa source et sa date ; jamais de `float` ;
- ADR 0032 : la clôture d'une quinzaine fige, pour chaque devise, le dernier taux lu le dernier jour de la quinzaine ou avant, dans le fuseau de l'agence. Sans taux, la clôture est refusée (`exchange_rate_missing_conflict`) : un taux n'est jamais deviné ;
- fiche EQ-04 : une source, rafraîchie par un job, valeur et date gardées, jamais de taux écrit dans le code.

La table `exchange_rates` existe (migration 0028) : clé (devise, jour), ajout seul, écrite par le job seul. Il manque la source et le job.

## Décision

**Source : le taux de référence de la Banque centrale européenne.** Il est public, gratuit, sans compte ni clé, et publié vers 16 h, heure d'Europe centrale, chaque jour ouvré TARGET. Rien à poser du côté de Charles. Aucune seconde source : si la BCE ne répond pas, le manque se voit, il n'est jamais comblé par un autre chiffre.

**Fichier lu : l'historique de 90 jours** (`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml`), pas le fichier du jour. Une panne de quelques jours se rattrape alors au passage suivant, jour par jour, sans rien inventer.

**Le job `payroll.fetch_exchange_rates`**, sans payload, chaque heure. Un passage qui ne trouve rien de nouveau n'écrit rien.

1. Il lit le fichier par un port de `payroll/infra`, avec un délai court (10 s) et une taille de réponse bornée (1 Mo). Le domaine ne voit jamais le réseau.
2. Il extrait chaque jour (`time`) et son taux en dollars (`currency='USD'`). Chaque valeur est validée par Zod avant toute écriture : un jour du calendrier, un taux décimal positif écrit avec un point. Un fichier sans aucun jour lisible est une erreur : rien n'est écrit, le job le dit.
3. Il convertit dans le domaine. La BCE donne des dollars pour un euro, la paie garde des euros pour un dollar. L'inverse se calcule en entiers depuis le texte décimal, sans `float` : pour `1.1188`, `rate_micros = mulDivRound(1 000 000, 10 000, 11 188) = 893 815`. L'arrondi est celui de toute la paie, au plus proche, demi qui s'éloigne de zéro.
4. Il écrit chaque (USD, jour) par `INSERT … ON CONFLICT DO NOTHING` sur la connexion admin, avec la source (`BCE, taux de référence`) et l'heure de lecture. Il est donc idempotent et rejouable. Un jour déjà écrit n'est jamais remplacé (déclencheur d'ajout seul) ; une valeur différente pour un jour déjà écrit est signalée en erreur dans le journal du job.
5. Week-ends et jours fériés : aucune ligne inventée. La clôture prend le dernier taux du dernier jour de la quinzaine ou d'avant, comme le dit l'ADR 0032.

**Cadence : chaque heure, à la 7ᵉ minute.** Le taux du jour arrive moins d'une heure après sa publication. Une panne de la BCE ou du réseau se rattrape à l'heure suivante, sans backfill de Graphile. Un fichier de quelques dizaines de Ko par heure ne coûte rien.

**Un taux trop vieux ne compte pas à la clôture.** Le plus long trou normal entre deux taux est de quatre jours : du jeudi au lundi de Pâques. La clôture refuse donc un taux de plus de quatre jours avant le dernier jour de la quinzaine (`exchange_rate_missing_conflict`), l'écart compté en jours civils dans le fuseau de l'agence, au lieu de figer en silence un taux d'il y a trois semaines laissé par un job arrêté. Ce refus ne vise que la clôture. Le brouillon d'une quinzaine en cours garde le dernier taux connu, puisque son taux n'est pas encore figé.

**Alerte système.** Quand aucun taux n'est arrivé depuis plus de deux jours ouvrés (lundi à vendredi), le job publie l'événement `exchange_rate_overdue` (`{ currency, lastRateDay, day }`), au plus une fois par jour et sans créatrice, comme `backup_overdue` (ADR 0028 § 5). Le propriétaire le reçoit par Telegram. Une devise qui n'a jamais reçu de taux (hôte coupé dès la mise en service, fichier toujours refusé : le job n'a jamais réussi) sonne aussi, avec `lastRateDay: null`, en production seulement : le délai se compte depuis la première planification du job sur la base (les tâches périodiques connues de Graphile Worker), dont le jour compte comme celui d'un dernier taux. Hors production, une base sans taux est le cas normal et ne dit rien. Il vient dans un second lot, une fois cette ADR acceptée : le type et ses deux contraintes (migration 0030, propriétaire de `packages/db`), puis la liste du déclencheur avec le rendu Telegram, puisqu'elle doit égaler `SCANNED_EVENT_TYPES` (un test les compare). Entre-temps, un trou se voit déjà : la clôture le refuse.

**Réseau.** Le worker parle à un seul hôte de plus, `www.ecb.europa.eu`, en HTTPS. Il n'envoie ni clé, ni donnée de l'agence. Si l'hôte est coupé, le job échoue à chaque heure sans rien écrire, puis l'alerte part. Les clôtures sont refusées dès que le dernier taux a plus de quatre jours. Rien n'est payé sur un faux taux.

## Conséquences

Positives :
- un taux officiel, le même pour toute l'équipe et pour toute la quinzaine, sans clé ni abonnement ;
- une panne se rattrape seule, et un manque se voit : il ne se remplit jamais d'un chiffre inventé ;
- c'est la conversion qu'admet le droit européen de la TVA : la directive 2006/112/CE, article 91, permet le dernier taux publié par la BCE.

Négatives :
- la BCE publie son taux « à titre d'information » et déconseille de s'en servir pour des transactions. Ici, il sert à convertir un chiffre d'affaires pour calculer une commission, pas à acheter ou vendre des dollars. Il n'est pas le taux auquel la banque de l'agence a converti les dollars de Reveal : l'écart entre les deux n'entre pas dans la paie ;
- une dépendance à un hôte externe, et à un format XML lu sans bibliothèque. Le format n'a pas changé depuis 1999. Un fichier qui change de forme ne donne aucun jour lisible : il est refusé, et l'alerte part ;
- un passage par heure sur la BCE.

Tests du lot :
- le lecteur contre des fichiers faits à la main au format de la BCE : 90 jours, un fichier vide, un taux mal écrit, une autre devise, des guillemets simples ou doubles ;
- la conversion sur des taux réels de la BCE, l'arrondi au demi compris ;
- le job contre un faux de la BCE : écrit les jours manquants, ne réécrit rien au passage suivant, ne remplace jamais un jour, n'écrit rien sur une panne, une réponse trop grosse ou un délai dépassé ;
- la clôture accepte un taux de quatre jours et refuse un taux de cinq, aux bords : le jeudi pour un lundi de Pâques qui finit la quinzaine, le vendredi pour un 31 décembre qui tombe un dimanche ;
- au second lot, l'alerte part après deux jours ouvrés sans taux, une fois par jour.

À surveiller :
- la première lecture réelle du fichier, à la recette : le conteneur de développement n'atteint pas la BCE ;
- si un jour un compte est payé dans une autre devise que le dollar, la contrainte `exchange_rates_currency_check` et `ForeignCurrencySchema` s'élargissent ; le lecteur prend déjà n'importe quelle devise du fichier.

## Alternatives rejetées

- **Saisie à la main dans Réglages** : un oubli bloque la clôture, et une faute de frappe passe sans contrôle.
- **Un fournisseur payant avec clé** : une clé et un abonnement de plus, pour un taux plus fréquent dont une paie par quinzaine n'a pas besoin.
- **Le fichier du jour seul** : une panne d'une journée laisserait un trou que rien ne comble.
- **Un miroir de la BCE (une API JSON tierce)** : un intermédiaire de plus entre la paie et la source, pour éviter vingt lignes de lecture XML.
- **Le taux du jour de la validation** : contredit l'ADR 0032. Deux relevés de la même quinzaine convertiraient les mêmes dollars à deux taux.
