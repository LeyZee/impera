# 0067. L'équipe installe l'extension depuis le CRM, puis depuis le Chrome Web Store en « non répertoriée »

Statut : accepted (Charles, 03/11/2026, 17 h 49, « ok 0067 » ; § 2 précisé : « ok phrases 0067 », 17 h 50 ; captures : « ok captures guide », 17 h 50 ; demande de Charles du 03/11/2026, 17 h 40 : « un guide dans le CRM […] pour installer l'extension […] pour l'équipe, les chatters, etc., et les managers. Et puis leur expliquer à quoi ça sert »)
Date : 2026-11-03
Précise : l'ADR 0066 (popup) et l'ADR 0027 (déploiement). Ne remplace rien.

## Contexte

Aujourd'hui, seule une personne qui a le dépôt sur son ordinateur peut installer l'extension : elle la construit, puis la charge « non empaquetée » en mode développeur. Un chatteur n'a ni le dépôt ni les outils. Il lui faut un fichier à télécharger, ou une fiche de magasin.

Deux voies existent :

- **Le fichier depuis le CRM** : un `.zip` à télécharger, à décompresser, puis à charger en mode développeur. C'est gratuit et immédiat. En revanche, il n'y a pas de mise à jour automatique : à chaque nouvelle version, il faut retélécharger et recharger. Chrome et Edge rappellent aussi, au démarrage, qu'une extension en mode développeur est active.
- **Le Chrome Web Store, en « non répertoriée »** : seuls ceux qui ont le lien la trouvent. L'installation se fait en un clic, et les mises à jour arrivent seules. Edge l'installe aussi depuis le Chrome Web Store (« Autoriser les extensions d'autres magasins »). Il faut un compte développeur Google (5 $ une fois, au nom de Charles ou d'IMPERA Agency), et chaque version passe par un examen de Google, de quelques heures à quelques jours. Le contenu d'une fiche non répertoriée reste soumis aux règles du magasin.

## Décision

1. **Maintenant : le fichier depuis le CRM.** Le CRM sert la dernière version de l'extension en `.zip` (`/extension/impera.zip`), construite avec le CRM : l'image du CRM la fabrique au même moment (ADR 0027), donc le CRM et l'extension vont toujours ensemble. Sur le PC de développement, le guide renvoie au dossier `apps/extension/.output/chrome-mv3`.
2. **Le guide** vit à côté de celui du téléphone : `/aide/extension`, ouvert à tous les rôles sauf la créatrice, avec un lien « Extension » dans le menu du compte sur ordinateur. Il dit à quoi sert l'extension, en mots d'équipe : se reconnecter au CRM d'un clic, retrouver ses raccourcis, la carte Reveal pendant le shift, la veille Instagram. Il ne dit rien des méthodes de l'agence, ni de l'IA au-delà de ce que voit déjà un chatteur dans le CRM. Ensuite, il donne les étapes pas à pas pour Chrome et pour Edge (le navigateur ouvert en premier), et comment la mettre à jour.
3. **Ensuite : le Chrome Web Store en « non répertoriée »**, dès que Charles a ouvert le compte développeur. Le guide passe alors à « Ajouter à Chrome » en un clic ; le `.zip` reste en secours. Le passage se fait par une fiche à part (compte, fiche du magasin, règles de confidentialité, examen).
4. **Aucune donnée dans le fichier** : le `.zip` est le même pour tout le monde. Il ne contient ni adresse de CRM, ni jeton, ni nom. L'adresse se règle dans le popup (ADR 0066 § 4).

## Conséquences

- Tant qu'on passe par le `.zip`, chaque mise à jour de l'extension demande à chaque membre de retélécharger et de recharger. Le popup affiche sa version en pied de page, pour qu'on voie qui est en retard.
- L'image du CRM grossit d'environ 1 Mo (le `.zip`, avec ses polices).
- Bilan relit la ligne du `Dockerfile` du CRM (ops).

## Alternatives écartées

- **Le magasin tout de suite** : il dépend d'un compte que Charles n'a pas encore et d'un examen de Google ; le guide ne peut pas l'attendre.
- **Edge Add-ons en plus** : un deuxième compte et un deuxième examen, alors qu'Edge sait installer depuis le Chrome Web Store.
- **Installer par une stratégie d'entreprise** (GPO) : il faudrait gérer les PC des chatteurs, ce que l'agence ne fait pas.
