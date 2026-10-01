# Publier une version

Les applications installées vérifient GitHub Releases (dépôt `Anadyomene30/MyPhotos`) au lancement puis toutes les 6 heures.
Windows télécharge la mise à jour et l'installe au redémarrage. Le Mac, tant qu'il n'est pas signé avec un Developer ID,
affiche seulement un lien de téléchargement.

1. Monter la version dans `package.json` (`npm version patch --no-git-tag-version`), committer.
2. Créer un jeton GitHub avec le droit `contents: write` sur le dépôt, puis l'exporter dans le terminal :

   ```sh
   export GH_TOKEN=<jeton>
   ```

3. Construire et envoyer les deux plateformes dans un même brouillon de release :

   ```sh
   sh scripts/build-mac.sh --publish always
   sh scripts/build-win-from-mac.sh --publish always
   ```

   (sur un PC Windows : `npm run build:win -- --publish always`)

4. Sur GitHub, ouvrir le brouillon `v<version>`, vérifier qu'il contient `latest-mac.yml`, `latest.yml`, le DMG, le zip et
   l'installeur `.exe`, puis le publier. Les applications le verront à leur prochaine vérification.

Les brouillons sont ignorés par les applications : rien n'est proposé tant que la release n'est pas publiée.
