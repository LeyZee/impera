# Module `redirect-links` : les liens de redirection d'une créatrice (ADR 0080 § 4, ADR 0120 § 3, ADR 0121 § 1)

Les liens de redirection d'une créatrice (`redirect_links`) : un nom, une adresse `https://`, où il mène, son endroit (`placement`), sa phrase d'usage, allumé ou éteint. Avant INS-03 ils vivaient dans le réglage du canal Telegram ; ils ont désormais leur table, parce que la créatrice les lit (« Mes liens ») et que les relevés de clics s'y rattachent.

- **Peut dépendre de** : aucun module (feuille). `telegram` et le connecteur de liens le lisent par son `index.ts`, branchés par le composition root.
- **Tables possédées** : `redirect_links` (migration d'INS-03).
- **Jobs émis** : aucun.

## Qui lit, qui écrit

- **Le propriétaire et un manager actif** créent, corrigent, placent, allument et éteignent les liens d'une créatrice.
- **La créatrice** lit ses seuls liens allumés qui ont un endroit, sous forme de cartes (`creatorLinkCards`) : un nom, un endroit, une phrase d'usage, l'adresse à copier. Jamais un chiffre, jamais une écriture.
- Un chatteur ne lit rien.

## État (INS-03)

Lot a : règles pures et ports. À venir : la table et sa recopie depuis le réglage du canal, les routes, l'écran.
