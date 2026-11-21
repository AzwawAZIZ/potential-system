# Audit et améliorations — Suivi MIAGE · UPJV

**Date :** 21 novembre 2026  
**Périmètre :** code de l’archive fournie, fonctionnement local, règles métier, import/export, navigation et contrôles automatisés. Cet audit est ciblé : il ne constitue ni une certification de sécurité, ni un audit RGAA exhaustif, ni un avis juridique.

## Synthèse

L’application d’origine est un prototype fonctionnel et déjà riche : sept rôles, dossiers, CRA, CRV, visites, missions, signalements, cycles, imports et gouvernance. Les données et les autorisations sont entièrement côté navigateur. Le projet convient à des démonstrations avec des données fictives, **pas à la gestion réelle d’étudiants**.

Les améliorations conservent les parcours et l’apparence du projet. Elles corrigent plusieurs défauts de cohérence et de présentation, mais ne transforment pas le prototype en service sécurisé multiutilisateur.

## Constats et traitements

| Priorité | Constat | Traitement ou action restante |
|---|---|---|
| Critique — restant | Absence de serveur d’autorisation et d’authentification réelle : tous les jeux de données et les règles sont accessibles ou modifiables dans le navigateur. Le mot de passe commun est public. | Ne pas utiliser de données personnelles réelles. Avant production : identité vérifiée, contrôle d’accès par ressource côté serveur, sessions sûres, séparation des données, protection et journalisation adaptées. |
| Haute — traité partiellement | Le stockage local pouvait échouer ou contenir un état illisible sans information durable ; une écriture suivante risquait de remplacer un état incompatible ou non lu. | `storage.js` effectue des contrôles structurels et détecte les erreurs d’accès. Une alerte durable précise le mode mémoire ; les données incompatibles ou potentiellement non lues ne sont pas écrasées automatiquement. Après une indisponibilité, copiez vos saisies puis rechargez la page pour relire les données. Il ne s’agit pas d’une validation exhaustive, d’une sauvegarde ou d’une restauration. |
| Haute — traité sur les points identifiés | La ville affichée dans la cohorte compacte n’était pas échappée ; certains autres champs étaient également interpolés directement. | Échappement ajouté sur les champs concernés et scénario de régression navigateur. Cela ne prouve pas l’absence de toute vulnérabilité ailleurs. |
| Haute — traité | Les formules CSV précédées d’espaces ou de caractères de contrôle pouvaient échapper à la neutralisation. | Neutralisation renforcée des exports CSV et test navigateur sur une valeur commençant par des espaces et `=`. |
| Haute — traité | L’import pouvait accepter des en-têtes ambigus ou des lignes CSV mal formées, et les doublons ou correspondances d’identité n’étaient pas assez contrôlés. | Vérification des colonnes et guillemets, numéros de lignes physiques, limite de 10 000 lignes dès l’aperçu, normalisation et vérification des doublons et des comptes liés, puis revalidation à la confirmation. Les enregistrements multilignes restent non pris en charge. |
| Haute — traité | Une demande de CRA d’un autre dossier ou de mauvais type pouvait être associée par une mutation directe ; des visites pouvaient recevoir des dates ou heures invalides et contourner certaines étapes. | Revalidation du rattachement du CRA, des dates et heures, et de la séquence proposée → confirmée → réalisée dans le moteur métier. |
| Haute — traité dans le prototype | Un nouvel encadrant pouvait consulter les messages d’un ancien cycle dans le dossier courant. | Le salon courant est sélectionné par cycle ; la lecture des archives est limitée à leurs acteurs et au responsable stages, avec filtrage des destinataires. Ce cloisonnement reste simulé et doit être réimplémenté côté serveur. |
| Moyenne — traité | Deux comptes pouvaient partager une adresse différente uniquement par la casse alors que la connexion est insensible à la casse. | Vérification d’unicité après normalisation de l’adresse des comptes. |
| Moyenne — traité | L’agenda était figé en novembre 2026 ; le second créneau ne pouvait pas être confirmé et un export tardif pouvait avoir une fin antérieure au début. | Navigation entre mois, sélection du créneau de visite, passage au lendemain, échappement des retours de ligne et définition du fuseau Europe/Paris dans le fichier `.ics`. La durée reste une heure de démonstration ; l’interopérabilité doit être testée avant un usage réel, notamment au changement d’heure. |
| Moyenne — traité | Les rejets CSV n’étaient pas téléchargeables lorsque toutes les lignes étaient invalides et omettaient la ville ; la ville d’une mise à jour valide était ignorée. | Téléchargement proposé dès l’aperçu, conservation de la ville dans les rejets et mise à jour de la ville si renseignée. |
| Moyenne — traité | L’inactivité n’était prolongée que par un clic ou geste de pointeur. Les filtres de journaux utilisaient une date de référence figée. | L’activité clavier et la saisie sont prises en compte ; les filtres utilisent les dates locales courantes. |
| Moyenne — traité | Le menu mobile fermé pouvait recevoir le focus et les filtres perdaient le focus après modification. | Menu masqué à la navigation clavier quand il est fermé, état du bouton synchronisé avec Échap et focus restauré sur les filtres et permissions modifiés. |
| Moyenne — restant | Des dates métier et données historiques demeurent fictives ou figées ; pièces jointes, e-mails et visas sont simulés. | Remplacer les dates et services fictifs après définition des règles réelles, ajouter stockage et contrôle des fichiers, notifications authentifiées et processus de signature adapté si nécessaire. |
| Moyenne — restant | Si l’état change entre l’aperçu et la confirmation de l’import, de nouveaux rejets peuvent apparaître. Les compteurs et motifs techniques sont conservés, mais la liste téléchargeable des rejets reste celle de l’aperçu initial. | Fournir dans une future version un compte rendu final ligne par ligne, sans exposer les données hors du périmètre autorisé. |
| Moyenne — atténué, restant | Une activité dans un autre onglet pouvait fermer un formulaire en cours. Les données locales ne disposent toujours pas d’une gestion transactionnelle des éditions simultanées, ni de sauvegarde/restauration opérationnelle. | Les simples mises à jour d’activité ne ferment plus la saisie. Lorsqu’une autre modification est détectée, un avertissement invite à copier la saisie et à recharger avant d’enregistrer. Cela ne remplace pas une détection transactionnelle des conflits ; changement de session et réinitialisation peuvent interrompre la saisie. Prévoir base de données, sauvegardes et reprise après incident. |
| Moyenne — restant | `app.js` regroupe de nombreux écrans et interactions ; les contrôles automatiques ne couvrent pas tous les scénarios ni toutes les technologies d’assistance. | Découper progressivement vues, état et services ; ajouter intégration continue et tests métier, sécurité, clavier, lecteur d’écran, zoom et appareils réels. |

## Vérifications

La recette finale exécutée après modification comprend **91 tests unitaires métier et de stockage**, **16 scénarios navigateur existants**, **13 scénarios navigateur de régression supplémentaires** et **41 écrans examinés par axe-core**, sans échec ni violation détectée pour les règles WCAG 2 A/AA et 2.1 AA sélectionnées. La version autonome a également été régénérée, ouverte et testée sans requête HTTP externe. La vérification `npm audit` ne signalait aucune vulnérabilité connue au moment de l’exécution.

Les tests ajoutés couvrent notamment les données locales illisibles ou inaccessibles, la protection des données non lues, l’échappement, les formules CSV, la navigation de l’agenda, le passage à minuit, l’activité clavier, les conflits entre onglets et les contrôles métier. Les commandes reproductibles figurent dans le `README.md` ; les anciens rapports et captures fournis dans l’archive restent des traces de la version initiale.

Les contrôles automatisés d’accessibilité n’évaluent que les règles et écrans effectivement parcourus. Ils ne remplacent pas une recette humaine ni une validation complète.

## Ordre recommandé pour une version réelle

1. **Cadrage métier et données** : valider les rôles, règles de transition, cycle de vie des dossiers, durées de conservation et responsabilités avec les équipes concernées.
2. **Socle serveur** : authentification adaptée à l’établissement, autorisations côté serveur sur chaque ressource, API, base persistante, séparation des environnements, sauvegardes et gestion des accès d’administration.
3. **Services réels** : stockage de pièces jointes avec contrôles adaptés, notifications, suivi des dates, processus de visa/signature et imports contrôlés côté serveur.
4. **Qualité et conformité** : tests automatisés et humains, évaluation des risques, vérifications de protection des données et d’accessibilité, supervision et plan de reprise avant mise en service.
