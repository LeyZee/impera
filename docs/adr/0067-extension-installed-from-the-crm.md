# 0067. L'équipe installe l'extension depuis le CRM, puis depuis le Chrome Web Store en « non répertoriée »

Statut : accepted (Charles, 03/11/2026, 17 h 49, « ok 0067 » ; § 2 précisé : « ok phrases 0067 », 17 h 50 ; captures : « ok captures guide », 17 h 50 ; demande de Charles du 03/11/2026, 17 h 40 : « un guide dans le CRM […] pour installer l'extension […] pour l'équipe, les chatters, etc., et les managers. Et puis leur expliquer à quoi ça sert »)
Date : 2026-11-03
Précise : l'ADR 0066 (popup) et l'ADR 0027 (déploiement). Ne remplace rien. Amendement du 19/11/2026 accepté (Charles, 19/11/2026, 19 h 50, « Valider » sur la carte du fil Extension, après les OK de Design et de Sécurité sur d2394025) : l'extension se relie au CRM depuis le CRM. Second amendement du 19/11/2026 accepté (Charles, 19/11/2026, 20 h 44, « Valider » sur la carte du fil Extension, après le OK de Sécurité sur aa6d0561) : la version hébergée connaît l'adresse du CRM.

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

## Amendement du 19/11/2026 : l'extension se relie au CRM depuis le CRM (accepté)

Demande de Charles du 19/11 : l'écran « Où s'ouvre ton CRM ? » à la première ouverture n'est « pas très intuitif ». Il veut faciliter au maximum la tâche des chatteurs, sans rien perdre en sûreté. Il a choisi « Lier depuis le CRM » (fil Bilan, 19/11).

Le § 4 tient toujours : le fichier reste le même pour tout le monde, sans adresse de CRM. Ce qui change, c'est la façon dont on règle l'adresse.

1. **Le geste part du CRM.** La page du guide (`/aide/extension`) porte un bouton « Relier l'extension à ce CRM ». Il mène à une page dédiée, `/extension/lier`, titrée « Relier l'extension à ce CRM », qui dit : « Clique sur l'icône Impera en haut à droite de ton navigateur. », puis, en dessous : « Tu ne la vois pas ? Clique sur la pièce de puzzle, puis sur Impera. » Un dessin aux jetons du design system montre les deux cas, avec le sélecteur Chrome / Edge de la page d'aide ; jamais la capture d'un vrai navigateur. Rien n'est à taper.
2. **L'extension lit l'adresse dans l'onglet, pas dans la page.** À l'ouverture du popup, le navigateur donne l'adresse réelle de l'onglet actif (droit `activeTab`). On compare l'adresse de l'onglet lui-même, jamais celle d'un cadre de la page. Son chemin doit être exactement `/extension/lier`, casse comprise : `/extension/lier/`, `/Extension/lier` ou `/extension/lier-x` ne proposent rien. Alors le popup propose « Relier l'extension à crm.exemple.fr ? », avec « Relier » et « Pas maintenant », et une ligne : « Ton navigateur va te demander d'autoriser ce site. Accepte. » Le nom du site s'affiche en entier et sous sa forme ASCII (`xn--…`), jamais sous sa forme Unicode. Rien de ce que la page affiche, ni de ce que contient son adresse après le chemin, n'est lu.
3. **Seulement une origine sûre** : `https://` sur le port par défaut. `http://` n'est admis que pour `localhost` et `127.0.0.1`, et le popup dit alors « Relier l'extension au CRM de cet ordinateur ? » au lieu d'un nom de site. Rien n'est proposé pour : un autre port, des identifiants dans l'adresse, un hôte terminé par un point, une adresse IP autre que `127.0.0.1`, un hôte non ASCII.
4. **Seulement à la première ouverture**, tant qu'aucune adresse n'a été enregistrée. Une fois l'extension reliée, une autre page `/extension/lier` ne propose rien : changer d'adresse passe par le bouton d'adresse du pied du popup, qui affiche toujours l'hôte relié. Ce changement passe par la même confirmation et les mêmes contrôles, et oublie tout ce qui tenait à l'ancienne adresse (code de liaison, modèles des synchronisations). Ainsi, un site qui imiterait la page ne peut pas détourner une extension déjà reliée. La page le dit donc d'avance : « Rien ne se passe ? Ton extension est peut-être déjà reliée : regarde la pastille en haut du popup. »
5. **« Relier » fait ce que faisait l'enregistrement d'une adresse** (ADR 0066 § 4) : le navigateur demande le droit sur ce site seul, dans le même clic, puis le popup vérifie que l'adresse répond comme un CRM où la personne est connectée : `/v1/me` avec une session ouverte, sans suivre de redirection, réponse validée par son schéma, et rien d'autre n'est envoyé à ce site pendant la vérification. Cette vérification ne protège pas d'un faux site, qui répond ce qu'il veut : elle évite seulement de se relier à un CRM où l'on n'est pas connecté. Si elle échoue, le popup dit « Cette adresse ne répond pas comme un CRM Impera. Recharge la page et réessaie. », n'enregistre rien et rend le droit sur le site accordé dans le clic. « Pas maintenant » ne garde rien non plus.
6. **La fin se voit des deux côtés.** Après « Relier », le popup dit « Extension reliée à crm.exemple.fr », puis passe à son accueil, et ramène l'onglet sur le guide (`/aide/extension`). La page n'apprend rien de l'extension : aucun canal entre une page et l'extension n'est ouvert, car n'importe quel site pourrait l'utiliser. Elle garde donc, sous sa consigne, un lien « Retour au guide ».
7. **La saisie reste possible**, derrière un petit lien « Saisir l'adresse » de l'écran d'accueil, pour le propriétaire et le développement. Un build de développement garde son raccourci vers `localhost:5173`.

Côté serveur : rien, la page `/extension/lier` est un écran du CRM, ouvert à tous les rôles qui ont le guide.

Conséquences : un chatteur n'a plus rien à taper. Il se connecte au CRM, ouvre « Extension » dans le menu de son compte, clique « Relier l'extension à ce CRM », puis l'icône de l'extension, puis « Relier », puis accepte la question du navigateur : cinq gestes. Le code de liaison (« Relier l'extension » de Moi › Sécurité, ADR 0066 § 7) ne change pas dans cet amendement, et c'est lui qui porte la sûreté : tant qu'il n'a pas réussi, l'extension n'envoie à l'adresse reliée ni session Reveal, ni capture, ni relevé, ni verdict. Relier une adresse ne donne donc rien de tout cela à un site par lui-même.

Risque résiduel, accepté : un faux site en `https://` qu'un chatteur ouvrirait avant de relier son extension. Aucun contrôle de l'extension ne le distingue, puisque son fichier ne contient aucune adresse (§ 4). Les défenses sont l'hôte affiché en entier, le premier lien seulement, et le code de liaison ci-dessus.

## Second amendement du 19/11/2026 : la version hébergée connaît l'adresse du CRM (accepté)

Demande de Charles du 19/11 : « une fois que ça soit hébergé, ça demande plus l'adresse ». Il a choisi « Les deux » (fil Extension, 19/11, 20 h 39) : l'adresse intégrée pour la version hébergée, et « Relier l'extension à ce CRM » pour son PC et pour un changement d'adresse.

Le § 4 change sur un point : le fichier peut porter **une** donnée, l'adresse publique du CRM qui le sert. Il ne porte toujours ni jeton, ni nom, ni rien d'autre, et reste le même pour toute l'équipe de ce CRM.

1. **L'adresse vient du build.** L'image du CRM fabrique l'extension (§ 1) avec l'adresse officielle du CRM dans une variable de build. Cette variable vient de la configuration du déploiement, jamais d'une requête (en-tête `Host`, paramètre) ni d'un réglage modifiable dans le CRM : le `.zip` est un fichier statique fabriqué une fois par image. Le build la vérifie et échoue sinon : `https://` seulement, un nom de domaine en ASCII, le port par défaut, sans chemin ni identifiants, sans joker ni point final. Une adresse en `http://`, une IP ou `localhost` ne passent pas : un build de développement n'en porte pas. La vraie adresse n'entre jamais dans le dépôt (ni `Dockerfile`, ni exemple, ni test, ni capture) : elle est fournie au déploiement, et les tests prennent `crm.exemple.fr`.
2. **Le droit sur ce site est donné à l'installation.** L'adresse entre dans les `host_permissions` du manifeste, exactement `https://<hôte>/*`, sans joker de sous-domaine. Un test lit le manifeste produit et vérifie que ce droit est le seul ajouté à ceux d'aujourd'hui. Le navigateur n'a donc aucune question à poser, et le chatteur aucun geste à faire.
3. **Pas d'écran d'accueil.** Avec une adresse intégrée, le popup s'ouvre directement sur le CRM, comme si elle avait été enregistrée. Une page `/extension/lier` ne propose rien (premier amendement, § 4). Le guide de la version hébergée ne montre donc plus l'étape « Relie-la à ce CRM » ni son bouton, qui mènerait à une page où rien ne se passe : la même variable de déploiement est passée au build du CRM, qui sait ainsi qu'il a construit l'extension avec son adresse.
4. **L'ordre des adresses** : une adresse enregistrée dans le popup (par le bouton d'adresse du pied) passe avant l'adresse intégrée, qui passe avant l'écran d'accueil. Une adresse enregistrée identique à l'intégrée ne compte pas comme un changement. Ainsi, si le CRM change d'adresse, le propriétaire relie l'extension à la nouvelle sans attendre une nouvelle version, avec les mêmes contrôles (premier amendement, §§ 3 à 5).
5. **Changer d'adresse se voit.** C'est le seul chemin vers un autre site pour une version hébergée, donc : la confirmation nomme les deux hôtes (« Cette extension est prévue pour A. La relier à B à la place ? Fais-le seulement si ton responsable te l'a demandé. »), avec deux boutons qui disent ce qu'ils font : « Garder A », le choix sûr, qui a le focus et le style le plus visible, et « Relier à B », un bouton doux, jamais le néon ; tant que l'adresse active diffère de l'intégrée, le pied le montre en ambre, avec « Revenir à l'adresse d'origine » en un clic, l'hôte d'origine dans son libellé accessible ; revenir oublie la liaison et rend le droit sur l'autre site. Une page `/extension/lier` reste ignorée.
6. **Sans adresse intégrée** (le PC de Charles, le développement), rien ne change : écran d'accueil, puis « Relier l'extension à ce CRM » ou la saisie.

Côté serveur : rien. Bilan relit la ligne du `Dockerfile` qui passe l'adresse au build (ops).

Conséquences : un chatteur installe l'extension téléchargée depuis le CRM, s'y connecte, et n'a plus rien à faire. Un changement d'adresse du CRM demande une nouvelle image, donc une nouvelle version de l'extension ; en attendant, le bouton du pied sert de secours. Le code de liaison (ADR 0066 § 7) ne change pas et porte toujours la sûreté des envois.

## Alternatives écartées

- **Le magasin tout de suite** : il dépend d'un compte que Charles n'a pas encore et d'un examen de Google ; le guide ne peut pas l'attendre.
- **Edge Add-ons en plus** : un deuxième compte et un deuxième examen, alors qu'Edge sait installer depuis le Chrome Web Store.
- **Installer par une stratégie d'entreprise** (GPO) : il faudrait gérer les PC des chatteurs, ce que l'agence ne fait pas.
