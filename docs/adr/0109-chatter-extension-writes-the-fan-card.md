# 0109. L'extension d'un chatteur écrit une case de la fiche du fan pendant son shift, et rien d'autre

Statut : accepted (« ok 0109 » de Charles le 13/11/2026, 2 h 53 heure de Paris, fil « Bilan », sur les huit règles du § Décision ; redit le 14/11/2026, 12 h 36 heure de Paris, dans le chat du projet ; numéro attribué par le coordinateur ; demande de Design, fiche CHA-30)
Date : 2026-11-14
Précise : l'ADR 0066 § 7 (l'extension écrit avec la liaison par personne, jamais avec le cookie du CRM), l'ADR 0086 § 8 (le panneau copilote écrit par cette liaison), l'ADR 0085 (fiche du fan) et l'ADR 0025 (le chatteur ne traite sa créatrice que pendant son shift). Ne remplace rien.

## Contexte

L'ADR 0086 place la fiche du fan dans le panneau de l'extension, à côté de la conversation Reveal, et l'ADR 0085 fait du chatteur celui qui corrige ce que l'IA a rempli. Aujourd'hui, le chatteur ne peut corriger une case que dans le CRM (`PUT /v1/fans/:id/card/:field`) : il doit quitter Reveal des yeux, ce que l'ADR 0086 § 10 refuse.

L'API refuse toute écriture qui ne vient pas de l'adresse du CRM (security.md § 6). La liaison de l'extension (VEI-01, ADR 0066 § 7) est l'exception prévue : un jeton par navigateur, tiré par le serveur, gardé haché, révocable. Elle sert aux relevés de veille et au verdict du copilote (`POST /v1/copilot/drafts/:draftId/verdict`). Mais elle ne dit pas ce qu'elle permet : tout ce qui l'accepte l'accepte en entier. Ouvrir une écriture de plus sur cette liaison, pour des chatteurs qui sont souvent des prestataires à l'étranger, demande que la portée soit écrite et bornée.

Sécurité a donné son avis le 13/11 : une route sœur calquée sur le verdict, avec la liaison seule et jamais le cookie, le droit calculé par la même fonction que le CRM, une réponse limitée à la case écrite, la liaison coupée au départ ou au changement de rôle, et une petite route pour que la popup valide la liaison.

## Décision

Les huit règles acceptées par Charles :

1. **Un chatteur relie son extension depuis « Ma sécurité »**, comme le propriétaire et les managers aujourd'hui. Le jeton s'affiche une fois et se colle dans la popup (ADR 0066 § 7).
2. **Un seul geste : écrire ou corriger une case de la fiche d'un fan**, avec le même droit que dans le CRM : la même fonction décide, pour la même personne, des mêmes cases.
3. **Seulement pendant son shift, sur les créatrices du shift** (`shiftCreatorIds`, marge comprise, ADR 0025). Hors shift, la route refuse comme le CRM refuse. Le propriétaire et un manager actif ne sont pas bornés par un shift.
4. **Tout le reste reste fermé par la liaison** : aucun envoi au fan, ni persona, ni argent, ni équipe, ni export, ni liste des fans.
5. **Les liaisons existantes ne gagnent rien en silence** : il faut relier l'extension à nouveau pour obtenir la portée de la fiche.
6. **Chaque case écrite entre au journal** avec la mention « depuis l'extension », sans sa valeur.
7. **La liaison peut être coupée à tout moment** depuis « Ma sécurité » ; elle l'est aussi d'office au départ du chatteur et à tout changement de son rôle.
8. **Tout autre geste depuis l'extension demande une nouvelle règle validée par Charles** (une ADR ou un amendement accepté).

Ce que cela veut dire dans le code :

- **Une portée écrite sur la liaison.** Chaque liaison porte la liste fermée de ce qu'elle permet (`scopes`), fixée à sa création. Une liaison existante garde ce qu'elle fait déjà (relevés de veille, verdict) et n'a pas la portée de la fiche. Une liaison créée après ce changement reçoit la portée de la fiche si la personne peut corriger une fiche dans le CRM.
- **Une liste fermée de routes, en code.** La preuve de la liaison ne remplace le contrôle d'origine que sur les routes de cette liste, chacune avec la portée qu'elle exige. Une route hors liste qui lit `x-extension-link` est refusée par un test. Le harnais d'isolation des routes couvre le chemin par liaison comme le chemin par cookie.
- **La route sœur** : `PUT /v1/copilot/fans/:id/card/:field`, à côté du verdict. Elle lit la liaison seule, jamais le cookie ; elle appelle la commande que la route du CRM appelle, par l'`index.ts` du module des fans ; elle ne rend que la case écrite, jamais la fiche entière ni un autre fan.
- **Une route pour la popup** : `GET /v1/extension/link` rend `{ role, displayName, scopes, expiresAt }` pour la liaison présentée, et rien d'autre. La popup s'en sert pour dire ce que la liaison permet.
- **Coupée au départ ou au changement de rôle** : la commande qui marque un départ, ou qui change le rôle d'un compte, révoque ses liaisons dans la même transaction.

## Lots

- (a) Serveur et contrat (fil Bilan) : la portée sur la liaison (une migration), la liste fermée des routes, la route sœur, `GET /v1/extension/link`, le journal, la révocation au départ et au changement de rôle, le harnais d'isolation. Relecteurs : Sécurité, et Agent sur l'écriture de la fiche. Si la fonction de droit sur la fiche doit sortir de son module par son `index.ts`, une petite PR du fil Agent passe avant.
- (b) Extension (fil Extension, avec l'avis de Design) : la case qui s'écrit depuis le panneau, la portée et l'échéance de la liaison dans la popup, « Ma sécurité » ouvert aux chatteurs. Relecteur : Bilan. Captures Nuit et Jour, PC et téléphone, devant Charles avant la fusion.
Tout passe d'abord dans le bac à sable (ADR 0075). Aucun envoi à un vrai fan.

## Conséquences

Positives :
- Le chatteur corrige la fiche sans quitter Reveal des yeux, et la correction a le même poids que dans le CRM.
- La liaison dit enfin ce qu'elle permet : une fuite de jeton n'ouvre que ce que sa portée écrit, sur les seules routes de la liste.
- Un départ ou un changement de rôle ferme l'extension en même temps que le CRM.

Négatives, à surveiller :
- Chaque chatteur doit relier son extension à nouveau pour écrire dans la fiche (règle 5).
- Un jeton volé pendant un shift permet d'écrire des cases de fiche jusqu'à sa révocation. Le journal dit « depuis l'extension », et le propriétaire coupe la liaison depuis la fiche du membre.
- La liste fermée des routes et les portées doivent rester en code. Une route ajoutée sans test reviendrait au contrôle d'origine, donc serait refusée : c'est voulu.

## Alternatives rejetées

- **Ouvrir la route du CRM à l'origine de l'extension** : le cookie du CRM servirait depuis l'extension, ce que l'ADR 0066 § 7 interdit, et toute route du CRM deviendrait atteignable de la même façon.
- **Donner la portée de la fiche à toutes les liaisons existantes** : un chatteur gagnerait une écriture sans geste de sa part (règle 5).
- **Une portée plus large d'emblée** (notes du chatteur, liste des fans) : chaque geste en plus est une règle de plus à faire valider (règle 8).
