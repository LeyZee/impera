# 0102. Les réponses corrigées au playground deviennent la banque d'exemples de la créatrice, lue aussi par la prod

Statut : accepted (« ok 0102 » de Charles, 12/11/2026 ; demande du même jour après l’avis sur le playground, recommandation 2)
Date : 2026-11-12
Précise : l'ADR 0019 (deux taux) et l'ADR 0022 (la persona fait partie de la version). Dépend de l'ADR 0103 (le playground en base). Ne remplace rien.

## Contexte

Au playground, quand le propriétaire corrige une réponse, la correction devient un exemple donné à la voix (`withExamples`, les 12 dernières). Trois défauts :

1. **La prod ne les lit pas.** Les brouillons du composeur (`draft-composer.ts`) reçoivent la fiche seule. Plus on corrige, plus le playground paraît bon, et plus il s'éloigne de ce que reçoit un fan.
2. **Elles ne sont pas rangées par créatrice.** Les 12 dernières corrections, toutes créatrices confondues, partent dans la fiche de celle qu'on joue.
3. **Elles vivent dans un fichier du PC** (`ratings.jsonl`), hors base et hors sauvegarde.

## Décision

1. **Une banque d'exemples par créatrice.** Une réponse corrigée au playground, sur une version de cette créatrice, entre dans sa banque. Jamais dans celle d'une autre. Une correction faite sur la persona fictive reste au playground et n'entre dans aucune banque.
2. **La prod et le playground lisent la même banque, par la même fonction.** Les 12 exemples les plus récents encore actifs, dans un bloc délimité de la fiche, comme aujourd'hui au playground. Ce que tu vois au playground est donc ce que reçoit un fan.
3. **Seul le propriétaire alimente la banque.** C'est déjà le seul rôle qui ouvre le playground ; la règle le fixe pour le jour où un autre rôle y entrera.
4. **Une correction passe les gardes avant d'entrer.** Si la réponse corrigée déclenche une garde bloquante (elle se dit IA, donne un contact, un prix hors grille…), elle reste notée comme correction mais n'entre pas dans la banque, et l'écran dit pourquoi.
5. **Le propriétaire voit et retire.** Entraîner affiche la banque de la créatrice (texte, date, message du fan qui l'a amenée) avec « Retirer ». Un exemple retiré ne sort plus nulle part ; il reste en base pour l'historique.
6. **Chaque brouillon dit quels exemples il a reçus.** Les identifiants des exemples partent avec l'appel de voix dans `llm_calls`, pour savoir après coup quelle correction a pesé sur quelle réponse.
7. **Ajouter ou retirer un exemple n'est pas un changement de version de la voix** au sens de l'ADR 0019 : le taux en réel continue, l'Automatique ne se referme pas. Le taux au playground, lui, est compté par version de persona (ADR 0103).
8. **Aucune vraie phrase dans le dépôt.** La banque vit en base ; les tests utilisent des phrases inventées.

## Conséquences

- Positives : le playground devient fidèle à la prod sur la voix ; chaque correction améliore réellement ce que reçoit un fan ; la banque est sauvegardée avec la base.
- Négatives : une mauvaise correction touche la prod dès qu'elle est enregistrée. La garde (règle 4) et « Retirer » (règle 5) sont les seuls freins.
- À surveiller : qu'une banque de 12 exemples très proches ne fige pas la voix (tous les messages se ressemblent). Si c'est le cas, on choisira les exemples par situation plutôt que par date, dans une ADR suivante.

## Alternatives rejetées

- **Le playground arrête de lire les corrections.** Fidèle, mais on perd le seul moyen rapide de régler la voix.
- **Les corrections n'entrent en prod qu'à la prochaine version de persona activée.** Plus prudent et plus mesurable, mais la boucle « je corrige, je vois » passe par une activation à chaque fois ; trop lent pour régler la voix au quotidien.
- **Une banque commune à toutes les créatrices.** Mélange les voix.
