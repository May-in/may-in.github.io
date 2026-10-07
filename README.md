# May’in

Portfolio d'architecture intérieure.

## Contrat de l'éditeur

- `content/site.json` et `content/projects.json` publiés font autorité pour les textes et images ; un brouillon reste local et n'est jamais effacé par un déploiement de code.
- `layout-model.js` porte les identités et l'ordre ; les boutons changent l'ordre réel des éléments, les réglages de position n'en changent jamais la hiérarchie.
- `script.js` rend le même contenu dans le site et l'aperçu du Studio. Les modifications d'un champ actif ne doivent pas reconstruire son nœud ni déplacer le curseur.
- La composition libre est réglée sur ordinateur ; tablette et téléphone réorganisent les mêmes éléments en flux lisible, sans débordement ni perte d'accès.
- Un élément superposé reste sélectionnable par clics successifs au même endroit. Les déplacements par glisser disposent aussi de boutons d'ordre.
- Avant publication : tests isolés `tests/*.cjs`, puis contrôle du contenu publié, du site et du Studio. Ne jamais publier un JSON local plus ancien que la version Studio en ligne.
