# 0089. Les vignettes d'une créatrice archivée sont effacées 90 jours après son archivage

Statut : proposed (choix de Charles sur la carte du fil Médias, 11/11/2026, 15 h 41 : « ok vignettes 90 jours » ; numéro attribué par le coordinateur ; texte à accepter par « ok 0089 »)
Date : 2026-11-11
Amende : l'ADR 0071 § 2 (« Rien n'est supprimé […] médias […] intacts »), pour les seules vignettes. Précise : l'ADR 0030 § 4 (on garde le minimum) et l'ADR 0044 § 2 (effacement des originaux). Ne remplace rien d'autre.

## Contexte

Depuis le lot c4 de SC-04, chaque photo et chaque vidéo qu'une créatrice dépose a une vignette réduite (`media_assets.thumbnail_key`), gardée après l'effacement de l'original pour que l'agence relise une description en voyant de quoi elle parle (ADR 0030 § 4). Rien ne l'efface : elle reste tant que la ligne du média existe.

Une créatrice archivée (ADR 0071) ne travaille plus avec l'agence. Ses originaux partent à leur date (au plus tard un an après le dépôt, 30 jours après leur publication). Ses vignettes, elles, resteraient pour toujours. Ce sont des images intimes d'une personne qui est partie : on ne les garde pas sans raison.

Le 11/11, la carte « Garder combien de temps les vignettes d'une créatrice archivée ? » a proposé deux choix. Charles a choisi « ok vignettes 90 jours » : ses vignettes sont effacées 90 jours après son archivage, ses descriptions et son historique restent, et si elle est rouverte avant, rien ne part.

## Décision

1. **90 jours après l'archivage, les vignettes partent.** Quand `creators.archived_at` a plus de 90 jours, chaque vignette d'un de ses médias (`media_assets.thumbnail_key` non nul, quelle que soit l'origine du média) est effacée du stockage, puis la clé est vidée. `thumbnailed_at` reste posé : la vignette n'est jamais refaite.
2. **Rien d'autre ne part.** La ligne du média, son empreinte, sa durée, son type, ses descriptions, les dépôts, les scripts, les ventes, la paie et l'audit restent, comme le veut l'ADR 0071. Les originaux gardent leur propre date (ADR 0044 § 2) : cette décision ne l'avance ni ne la recule.
3. **Rouverte avant 90 jours, rien ne part.** La réouverture vide `archived_at` : le compte repart de zéro à un nouvel archivage. Rouverte après, ses vignettes ne reviennent pas ; la relecture montre le média sans image (l'original, tant qu'il est gardé, s'ouvre toujours en grand).
4. **Par le job horaire des originaux.** L'effacement est une étape de plus de `content_drops.erase_originals`, sous le rôle administrateur, média par média et sous le verrou de sa ligne. Un stockage qui refuse ou ne répond pas laisse la vignette en place ; l'heure suivante réessaie. Rejoué, le job n'efface rien deux fois.
5. **Audit et écran.** Chaque passage qui efface des vignettes d'une créatrice écrit une ligne d'audit (`media.thumbnails_erased`, la créatrice et le nombre, jamais une clé ni une image). Dans la liste repliée « Archivées », la créatrice dit jusqu'à quand ses vignettes sont gardées, puis qu'elles sont effacées ; la confirmation d'archivage le dit avant.

## Conséquences

- Pas de migration : `archived_at` et `thumbnail_key` existent ; la contrainte `media_assets_thumbnail_check` accepte une clé vide.
- Le délai de 90 jours est une constante du code, à côté des autres durées de rétention, testée ; il ne devient pas un réglage.
- Une créatrice archivée par erreur a trois mois pour être rouverte sans rien perdre.

## Alternatives rejetées

- **Garder les vignettes tant que la ligne existe** (« ok vignettes gardées ») : rien n'efface jamais des images intimes d'une créatrice partie.
- **Les effacer dès l'archivage** : une erreur d'archivage ferait perdre toutes les vignettes sans retour.
- **Effacer aussi les descriptions** : elles servent à l'historique (ventes, scripts) et ne montrent pas son corps ; Charles a choisi de les garder.
