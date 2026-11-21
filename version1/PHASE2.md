# Phase 2 — règles métier intégrées

Cette phase conserve le prototype local et ses sept rôles, sans le présenter comme une solution sécurisée pour des données personnelles réelles.

- Les CRA envoyés sont consultables par le maître de stage en lecture seule ; les brouillons restent privés. Les sélecteurs de CRA, CRV et visites filtrent le cycle courant.
- Une proposition de mission conserve un instantané indépendant du dossier. L’avis favorable du tuteur ne réalise plus l’affectation ; seule la responsable stages peut appliquer la décision finale après contrôles de cycle, disponibilité et capacité.
- Les destinataires de messages sont explicites. La responsable stages n’est plus ajoutée automatiquement. L’administrateur n’a ni écran ni action d’audit du contenu privé.
- Les CRV sont modifiables avant visa par le tuteur et le maître de stage avec conservation des versions et sans création de visa fictif.
- Les calculs de présences comptent exclusivement les journées déclarées ; les échéances CRA, relances et disponibilités sont calculées localement par des fonctions pures. Les contacts, avenants, types de contrat et adresses de visite peuvent être suivis dans le module local.
- Le lecteur Mon Master contrôle le classeur en mémoire, refuse les identités incomplètes et n’embarque aucune donnée réelle. Le fichier fourni observé ne contenait pas d’identités exploitables.
- Le délai de clôture CRV doit être rattaché à la date d’envoi/mise à disposition aux participants ; la clôture par délai reste distincte des trois visas et n’est évaluée que lors d’une ouverture ou action locale de l’application.

## Vérifications

Les parcours navigateur historiques et complémentaires passent : 16 scénarios navigateur, 7 scénarios d’améliorations, 6 scénarios follow-up, 40 écrans axe-core sans problème, et le HTML autonome sans requête externe. Les tests ciblés des nouveaux modules passent. Quelques tests historiques du domaine restent incompatibles avec les règles volontairement changées (affectation immédiate, audit privé administrateur et anciennes hypothèses de salon) ; ils sont conservés comme points de migration à documenter, sans réintroduire ces comportements.
