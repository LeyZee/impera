# 2026-11-21 — INS-02 lot e2a (table des heures d'un lien et lecture par créatrice) — in progress

Fait : migration 0245 (`redirect_links.service_ref` avec la politique `owner_attach` et un droit par colonne ; table `redirect_link_hours` sous FORCE RLS, politiques de la tâche `link_hours`, heure close figée dans la base) ; domaine (`readingWindow`, `hoursOfWindow`, port `LinkHourStore`), cas d'usage `readLinkHours`, magasin Drizzle sous `withTenantJob`. Tests : politiques (5 nouveaux dans `redirect-links-rls`), magasin et cas d'usage contre `FakeLinkStats` (3), domaine (2).
Reste : lot e2b (route « relier ce lien », remise à nul de la référence quand l'adresse change, tâche horaire câblée avec la clé et le budget d'appels), lot e3 (affichage dans Trafic, captures).
Découvertes : un `INSERT … ON CONFLICT DO UPDATE` qui rencontre une ligne que la politique de mise à jour refuse fait échouer toute l'instruction ; le magasin écarte donc d'abord les heures closes.
