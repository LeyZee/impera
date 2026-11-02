# 0053. Clé d'accès (Face ID, empreinte) : un geste vaut mot de passe et code

Statut : proposed
Date : 2026-11-02

## Contexte

L'ADR 0046 rend obligatoire, pour chaque compte, un mot de passe puis un code à 6 chiffres d'une application d'authentification. Elle range les clés d'accès (passkeys, WebAuthn) parmi les alternatives : « la meilleure protection », à venir « en option dans un second temps ». L'ADR 0042 prévoit Face ID pour la créatrice, et la fiche CR-01 (lot c) en fait l'étude.

Sur un téléphone, la connexion de l'ADR 0046 coûte un mot de passe, puis un passage par l'application d'authentification pour recopier un code. Les chatteurs le font au plus une fois par mois et par appareil grâce à l'appareil de confiance. Mais chaque action sensible redemande les deux, et la créatrice, qui ouvre Nirvana depuis son téléphone pour son agenda, doit le faire à chaque fois.

Une clé d'accès est une paire de clés dont la partie privée ne quitte pas l'appareil (synchronisée par le trousseau Apple ou Google), débloquée par le visage, le doigt ou le code du téléphone. Le serveur ne garde que la partie publique. La clé est liée au domaine de Nirvana : une fausse page de connexion ne peut pas s'en servir. Un seul geste réunit deux facteurs : l'appareil qu'on possède, et le visage, le doigt ou le code qui le déverrouille.

Charles a choisi le 02/11/2026 à 20h55 que la clé d'accès remplace le mot de passe et le code (« Face ID remplace tout »), plutôt que le code seul ou rien pour l'instant.

## Décision

1. **Une clé d'accès vaut mot de passe + code.** Se connecter avec une clé d'accès ouvre la session sans mot de passe ni code. Le navigateur exige la vérification de la personne (`userVerification: required`) : une clé qui ne demande ni visage, ni doigt, ni code du téléphone est refusée. L'ADR 0046 § 1 est ainsi précisée : le deuxième facteur reste obligatoire pour chaque compte, et une clé d'accès en tient lieu à la connexion.
2. **Proposée, jamais imposée, et jamais à la place du code.** Une clé ne s'ajoute qu'à une session dont le mot de passe et le code ont été confirmés depuis moins de 5 minutes, par la confirmation de l'ADR 0046 § 3 (`reauthenticated_at`), jamais par l'appareil de confiance de la connexion. Elle est liée au compte de la session, jamais à un compte venu du corps de la requête. Nirvana la propose après une connexion réussie (« Te connecter avec Face ID la prochaine fois ? »), une fois par appareil, et dans Réglages › Sécurité.
3. **Le code reste la porte de secours.** L'activation du code et des dix codes de secours de l'ADR 0046 reste obligatoire pour chaque compte, avant toute clé. Sur un appareil sans clé (nouveau téléphone, ordinateur prêté), on se connecte avec le mot de passe et le code.
4. **Les actions sensibles redemandent le geste.** Une action de la liste de l'ADR 0046 § 3 accepte, au choix, le mot de passe et le code, ou un nouveau geste : une assertion sur un défi neuf, émis par le serveur pour cette session et cette confirmation (jamais le geste de la connexion), faite avec une clé du compte de la session. Ce geste horodate `reauthenticated_at` comme le mot de passe et le code : la vérification d'une connexion récente reste le seul contrôle. Un appareil de confiance n'en dispense jamais.
5. **Écrans Sécurité (ADR 0046 § 7).** Un panneau « Clés d'accès » dans Réglages › Sécurité, Moi › Sécurité et `/compte/securite`. Chacun y voit ses clés (appareil, date d'ajout, dernière utilisation) et peut les retirer, avec le mot de passe et le code ou un geste sur une autre clé. Dans la vue du propriétaire, chaque compte affiche « N clés » à côté de l'état de son code, sans détail d'appareil ; le propriétaire peut retirer toutes les clés d'un membre. Toutes les clés d'un compte partent aussi à la remise à zéro du deuxième facteur (commande d'exploitation pour le propriétaire), au lien de nouveau mot de passe (EQ-10) et au départ d'un membre (EQ-14). Fermer des sessions ne retire pas les clés : c'est un geste distinct, et l'écran les montre côte à côte.
6. **Mêmes règles que la connexion par mot de passe.** Seuls les refus vérifiés par le serveur comptent (signature fausse, clé inconnue, compteur anormal, mauvaise origine) ; un Face ID annulé n'atteint pas le serveur et ne rapproche pas du verrouillage. Une connexion par clé n'a pas d'e-mail : la limite par compte de l'ADR 0046 § 5 se fait sur le compte de la clé quand il est connu, sinon sur l'adresse. Ces refus comptent dans l'alerte des 5 refus en 15 minutes. La durée absolue de 7 jours (§ 6) s'applique à la session ouverte par une clé.
7. **Alertes (ADR 0046 § 8).** Une clé ajoutée à n'importe quel compte, porte durable comme la remise à zéro du code, et une connexion du propriétaire par une clé jamais vue envoient une alerte au groupe urgent. Chaque ajout, retrait et refus est une ligne d'`audit_log`, sans donnée biométrique : il n'en existe aucune côté serveur.
8. **Mise en œuvre.** Le plugin `@better-auth/passkey` à la version de Better Auth du dépôt (1.7.7, publiée le 30/09/2026, quarantaine de 14 jours passée), avec `@simplewebauthn/server` et `@simplewebauthn/browser` 13.3. Pas d'attestation demandée (`attestation: none`) : on ne restreint pas les marques de téléphone. Le domaine de la clé est celui du dashboard ; l'origine est vérifiée à chaque geste. La table des clés est une table d'authentification, hors RLS comme les autres, écrite par le seul module d'authentification ; sa migration prend son numéro à la fusion.

## Conséquences

- Sur un téléphone récent, se connecter coûte un regard ou un doigt, et une action sensible aussi : la créatrice et les chatteurs n'ouvrent plus l'application d'authentification au quotidien.
- La protection monte : une clé d'accès ne se laisse pas hameçonner, ce qu'un code à 6 chiffres recopié sur une fausse page ne garantit pas.
- Un téléphone déverrouillé par son code ouvre Nirvana : la clé ne vaut que ce que vaut le verrouillage du téléphone. Le guide d'installation (`/aide/installer`) le dira.
- Un trousseau Apple ou Google compromis donne la clé : c'est le prix de la synchronisation, accepté par les banques et les grands services ; retirer la clé dans Réglages › Sécurité suffit à la couper.
- Trois dépendances de plus côté serveur et page, toutes hors quarantaine.
- Le code et les codes de secours restent à configurer à l'arrivée, créatrice comprise : la clé allège le quotidien, pas l'inscription.
- Les clés sont liées au domaine du dashboard : un changement de domaine les rend toutes inutilisables, et chacun repasse par le mot de passe et le code, puis en ajoute une nouvelle.

## Alternatives rejetées

- **La clé remplace seulement le code** : on tape toujours le mot de passe sur le téléphone ; on gagne peu, pour la même complexité.
- **Plus tard** : rien ne change, les chatteurs continuent de taper mot de passe et code ; écarté par Charles le 02/11.
- **Clé d'accès obligatoire** : tous les appareils n'en ont pas (ordinateur partagé, vieux téléphone Android), et un compte sans porte de secours se perd avec son téléphone.
- **Ajouter une clé depuis un appareil de confiance** : un cookie volé suffirait à poser sa propre clé sur le compte ; l'ajout exige donc le mot de passe et le code confirmés depuis moins de 5 minutes.
- **Retirer les clés en fermant les sessions** : deux gestes différents ; on ferme une session volée sans perdre Face ID sur son propre téléphone.
