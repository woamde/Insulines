# GlycoSoin T1D — PRD

## Problème initial
"Je veux créer une application de contrôle et de surveillance du diabète de type 1, avec calcul des glucides." (interface 100 % française)

## Choix utilisateur
- Fonctionnalités complètes : suivi glycémie, calcul des glucides, calcul de dose d'insuline, historique et statistiques.
- Repas avec photos ; calcul d'insuline personnalisé (ratio I/C, ISF, glycémie cible).
- Graphiques d'évolution de la glycémie ; profil (taille, âge, poids, ancienneté du diabète).
- Thème clair et médical.
- Compatibilité capteurs CGM : Dexcom, FreeStyle Libre (LibreLinkUp), Nightscout.
- Connexion Google Emergent obligatoire ; données privées par compte.
- IA : assistant chat (Claude/Gemini au choix), analyse de photo de repas (Gemini vision), bilan hebdomadaire (Claude).

## Personas
- Personne vivant avec un diabète de type 1 (ou aidant) suivant glycémies, glucides et insuline au quotidien.

## Architecture
- **Frontend** : Expo Router, thème clair médical (`src/theme.ts`), onglets Accueil/Bolus/Journal/Stats + écrans stack (login, profil, assistant, cgm, ajout glycémie/repas). @tanstack/react-query. Graphique SVG.
- **Auth** : `src/auth.tsx` (AuthContext + gate root-layout), token en secure-store (mobile) / localStorage (web).
- **Backend** : FastAPI + MongoDB, routes `/api`. Modèles `BaseDocument` (PyObjectId, `_id`→`id`), soft-delete.
  - `auth.py` : Emergent Google (`/auth/session`, `/auth/me`, `/auth/logout`), `get_current_user`, index users/sessions.
  - `ai.py` : `/ai/chat` (Claude/Gemini), `/ai/analyze-meal` (Gemini vision), `/ai/weekly-summary` (Claude), `/ai/models`, `/ai/messages` — via emergentintegrations + EMERGENT_LLM_KEY.
  - `cgm.py` : Dexcom Share, LibreLinkUp (redirection région + CGU), Nightscout.
  - Stockage photos : Emergent Object Storage.
- Toutes les données scopées par `user_id`.

## Implémenté
- 2026-06 : Profil, suivi glycémie, base d'aliments FR (~120), calculateur de bolus, repas + photos, journal, statistiques (TIR/HbA1c/graphique), capteurs CGM. Validé e2e.
- 2026-06 (itération 2) :
  - Correction LibreLinkUp (redirection de région, CGU, messages d'erreur clairs).
  - **Connexion Google Emergent** obligatoire + gate d'authentification.
  - **Isolation des données par compte** (user_id sur profil/glycémie/repas/CGM/IA).
  - **Assistant IA** (chat Claude/Gemini, choix du modèle, historique).
  - **Analyse de photo de repas** (Gemini vision → estimation glucides, pré-remplissage des aliments).
  - **Bilan hebdomadaire IA** (Claude) dans les statistiques.
  - Validé : 31/31 tests backend, gate frontend OK.
- 2026-06 (itération 3) :
  - **Bug « Non authentifié » (CGM)** : cause racine = gate d'auth par redirection ignorée sur Expo Go (écran capteur atteint sans session Google, aucun appel Abbott). Fix durable : `Stack.Protected` déclaratif + relecture du jeton persistant avant chaque appel (`src/session.ts`) ; retour d'erreur explicite si la connexion Google échoue.
  - **LibreLinkUp durci** (`cgm.py`) : session/cookies, User-Agent iOS, `product: llu.ios`, version auto-adaptée (status 920 → minimumVersion), cache du ticket d'auth (`libre_auth`), détection blocage Cloudflare, statuts 2/4/429/430 et étapes compte (CGU, confidentialité, e-mail, date de naissance) traduits en messages actionnables.
  - **Insuline lente (basale)** + bolus/correction hors repas : `/api/insulin`, écran d'ajout, ligne « Insuline lente » sur l'accueil, journal, stats (basale/bolus/jour), PDF.
  - **Suivi du poids** (prise/perte) : `/api/weight`, écran + historique, delta et IMC, carte tendance dans Stats, section du PDF.
  - **Rappels doux** (notifications locales `expo-notifications`, DAILY) : 4 rappels glycémie + 1 basale, horaires par pas de 15 min, permissions contextuelles avec « Ouvrir les réglages ». Web : réglage seulement.
  - **Rapport médecin PDF** (`report.py`, reportlab) : 14/30/90 j (défaut 90), patient, synthèse (moyenne, HbA1c estimée, CV, hypo/hyper), TIR, courbe, insuline basale/bolus, glucides, poids, détail journalier. Partage natif (expo-sharing) / téléchargement web.
  - Dates Mongo relues en UTC (`tz_aware=True`) → heures correctes sur mobile.
  - Validé : 59/59 tests backend + parcours UI web (rapport `/app/test_reports/iteration_2.json`).
- 2026-06 (itération 4) :
  - **Objectifs personnels** : plage cible basse/haute + objectif TIR dans le profil (validés), appliqués aux stats, aux zones de couleur (accueil, journal, saisie), à la carte TIR (badge objectif atteint) et au PDF.
  - **Envoi du rapport au diabétologue** : nom + e-mail du médecin dans le profil ; `POST /api/report/email` (Emergent Resend, destinataire côté serveur, PDF en pièce jointe, 5 envois/jour max) ; bouton dans la carte rapport des Stats.
  - Diagnostic « Non authentifié » : logs 401 avec User-Agent → requêtes Android (okhttp) sans jeton, jamais de `/auth/session` depuis le téléphone sur ce backend. Hypothèse retenue : **APK installé = ancienne build (pré-authentification)** qui parle à un backend redéployé avec authentification → il faut republier puis régénérer/installer un nouvel APK. Le compte LibreLinkUp (free.fr) est indépendant du compte Google.
  - Validé : 11/11 tests backend + parcours UI (`/app/test_reports/iteration_3.json`).
- 2026-06 (itération 5) :
  - **Unités mmol/L** : option dans le profil (stockage inchangé en mg/dL), conversion de l'affichage et des saisies partout (accueil, journal, stats, courbe, saisie glycémie, calculateur, repas, paramètres ISF/cibles).
  - **Activité physique** : séances (type, durée, intensité, moment), effet mesuré (moyenne 2 h avant → 2 h après, alerte hypo post-effort), bandes bleues sur la courbe des Stats, journal, accueil, section du PDF.
  - **Partage proche** : liens révocables (max 5) → page publique `/proche/<jeton>` sans connexion : dernière glycémie, tendance, résumé 24 h, courbe ; compteur de vues ; consigne d'urgence 15/112.
  - Fix : route racine sans session → login (vue publique déclarée en dernier dans la pile).
  - Validé : 12/12 tests backend + parcours UI (`/app/test_reports/iteration_4.json`).
- 2026-06 (itération 6) :
  - Logs : **connexion Google réussie** depuis le téléphone Android (preview) ; **Abbott refuse les identifiants LibreLinkUp** (status 2) du compte free.fr → cause côté compte Abbott (type de compte LibreLinkUp vs LibreLink/LibreView, espaces, mot de passe), pas côté app.
  - Écran capteur : bouton « Tester les identifiants » (`/api/cgm/test`, sans enregistrement), encadré de résultat, check-list LibreLinkUp en 4 étapes, message d'erreur Abbott détaillé.
- 2026-06 (itération 7) :
  - **Crash Expo Go Android corrigé** : `expo-notifications` n'est plus importé statiquement (il n'existe plus dans Expo Go Android depuis le SDK 53 et faisait planter l'app au lancement) ; chargement paresseux + message explicatif dans Rappels. Les rappels fonctionnent dans Expo Go iOS et dans l'APK.
  - **Import LibreView** : écran Profil › « Importer mon historique LibreView » (CSV glucose_data.csv FR/EN, mg/dL ou mmol/L, par lots, sans doublon : glycémies, insuline rapide/lente, glucides).
  - **Alerte hypo aux proches** : e-mail d'alerte optionnel par lien de partage ; envoi automatique (saisie ou synchro CGM) si glycémie < cible basse, mesure récente (< 2 h), 1 alerte max/heure/lien.
  - Validé : 10/10 tests backend + parcours UI (`/app/test_reports/iteration_5.json`).
- 2026-06 (itérations 8-9) :
  - **Bug login Google sur build déployée** : `insert_one` sur index unique `session_token` → 500 à la reconnexion (Emergent renvoie le même jeton). Fix `auth.persist_session()` idempotent + message d'erreur serveur affiché sur l'écran de connexion. Validé 8/8 (`iteration_6.json`). ⚠️ Nécessite Publish + nouvelle build.
  - **Plusieurs IA** : GPT-5.4 / GPT-5.4 mini ajoutés (Claude, GPT, Gemini au choix partout).
  - **Coach IA** (`/api/ai/coach`, écran Coach, carte accueil) : analyse croisée glycémies par moment de la journée, basale/bolus, repas (glycémie 2 h après), sport (effet mesuré), poids → tendances, pistes alimentation/activité/organisation de l'insuline (sans dose), questions pour le diabétologue, alerte. Historique dans `ai_coach_reports`.
  - **Recontrôle hypo** : notification locale 15 min après une glycémie < cible basse + bannière accueil.
  - **Libre multi-patients** : choix du patient suivi après « Tester les identifiants » (le compte de l'utilisateur suit 2 personnes).
  - Constat logs : LibreLinkUp de l'utilisateur **fonctionne** (login Abbott OK, 52 mesures synchronisées).
  - Validé : 7/7 backend + UI (`iteration_7.json`).

### Phase 10 — Diagnostic connexion Google sur build déployée (en cours)
- Symptôme utilisateur (build téléphone, pas Expo Go) : « Impossible de charger vos données. Vérifiez votre connexion » puis retour écran de connexion → requêtes protégées en 401 après `/auth/session` (constat du health-check de déploiement).
- Livré : messages d'erreur explicites (hôte du serveur, statut HTTP, détail 401 : Session invalide / expirée / Non authentifié) sur l'accueil et l'écran de connexion ; échange de session partagé (plus de faux échec quand deep link + retour navigateur arrivent tous deux) ; repli `Linking.openURL` si aucun navigateur custom-tabs ; logs backend des 401 avec raison + UA.
- Corrections déploiement : `EMAIL_FROM_NAME` quoté dans backend/.env ; descriptions iOS caméra/photos + plugin expo-image-picker dans app.json ; erreurs TypeScript (cgm.tsx, theme.ts).
- À faire : l'utilisateur redéploie (Publish), installe la **dernière** build et rapporte le message exact affiché.


### Phase 11 — Suppression du compte (validée API + interface mobile web)
- Demande : « Test LibreLinkUp ... Tester les identifiants ... free.fr » et suppression du compte dans l'app, effaçant les données associées.
- Retour utilisateur : « le prototype via expo go fonctionne bien maintenant ». Ne pas extrapoler à une build native installée.
- Journaux consultés : dernière synchro LibreLinkUp disponible réussie (2 patients). Pas de nouvelle tentative « Tester les identifiants » identifiable depuis cette demande ; aucune connexion au compte réel exécutée par l'agent.
- Ajout de Profil → Supprimer mon compte → écran dédié avec liste des données, export PDF optionnel, consentement explicite, bouton destructif, annulation et retour au login confirmé.
- `DELETE /api/auth/account`, session obligatoire et corps strict `{confirmation: "SUPPRIMER"}`. Identité provenant exclusivement de la session ; purge physique MongoDB de toutes les collections `user_id`, archives incluses, puis sessions et identité.
- `account_lifecycle.py` : barrière lecture/effacement par compte ; attend les requêtes en cours (CGM/IA/upload) pour éviter de réintroduire des données après purge. Mécanisme intra-processus adapté au serveur actuel à un worker ; coordonner entre workers avant d'en ajouter.
- Échec partiel : marque persistante `account_deletion_pending` ; `/auth/me` et suppression seuls autorisés, accès partages/photos refusé ; reprise depuis écran dédié après reconnexion.
- Photos : registre `uploads` créé avant chaque envoi (y compris repas abandonné), vérification de propriété au rattachement d'un repas. Récupération des anciens chemins depuis les repas, archives incluses. Le stockage géré n'offre PAS de DELETE : les octets de chaque photo sont écrasés par un objet vide, puis la référence MongoDB est effacée. Les objets vides restent chez le fournisseur. Photos orphelines antérieures sans référence propriétaire non attribuables ; aucun repas avec photo présent dans cette base au début du travail.
- Local : suppression du jeton, cache React Query, notifications programmées/affichées, cache images et rapports PDF de l'app. Ne supprime pas les originaux dans la galerie, les copies déjà exportées/e-mails, ni les comptes Google/Abbott. Nettoyage sur un autre appareil lors de la prochaine vérification de session, pas à distance appareil fermé.
- OAuth existant préservé ; aucun endpoint de révocation Google non documenté inventé. Sessions applicatives révoquées sur tous les appareils.
- Tests : rapport `test_reports/iteration_8.json`, 4/4 scénarios backend (nombreux contrôles : confirmation, isolation, sessions, photos réelles, reprise, doublon, compte recréé vide) et parcours UI 390/320 px réussis. Annulation, erreur simulée, double appui, export PDF, succès et retour login vérifiés. Pas de test de nettoyage sur appareil natif dans cet environnement.
- Vérification finale : teardown de test corrigé (compte recréé également nettoyé) ; seconde exécution backend 4/4 réussie, rapport `test_reports/pytest/iteration10_final.xml`.
- Démarrage preview : Expo CLI échouait lors d'appels réseau de développement (502 transitoire). `EXPO_OFFLINE=1` ajouté au frontend pour éviter ces appels CLI, sans désactiver les API de l'application ni toucher aux URLs protégées. Preview et backend 200 + screenshot login après redémarrage.
- La valeur de repli `STORAGE_BASE` est conservée conformément au contrat d'intégration officiel (variable proxy parfois vide), malgré une suggestion générique du rapport de test.

### Phase 12 — Web installable Windows 11 / Ubuntu (export/API/UI validés)
- Demandes exactes : « donne moi le code complet de l'application et de ses options », puis « je veux en faire une application web installée sur mon pc win11 et ma vm Ubuntu ».
- L'utilisateur a ignoré les questions. Choix annoncé par défaut : un serveur local commun dans la VM Ubuntu, Windows et Ubuntu clients de la même PWA. Aucune réécriture/remplacement de l'application mobile.
- Export Expo web `single`, `public/index.html` français, manifeste SVG, service worker minimal (cache uniquement page hors connexion / icône / manifeste). Aucun cache des API, sessions, photos, PDF ou données médicales. Bandeau offline et pas de file d'attente des mutations web.
- Interface React Native partagée ; `WebAppShell.web.tsx` ajoute barre d'installation/aide Windows/Ubuntu, invite d'installation lorsqu'offerte par le navigateur, conteneur adapté aux grandes largeurs. Variante native transparente. Login défilable pour petits écrans.
- `app.config.ts` expose l'URL via Constants.expoConfig ; script `frontend/scripts/export-local-web.mjs` force API same-origin et ignore les .env de l'aperçu. Configuration/OAuth native protégée préservée.
- Backend `web_app.py` : distribution statique optionnelle derrière WEB_DIST_DIR ; routes SPA, API inconnues 404, chemins privés refusés, no-store. Middleware API no-store. Inactif dans l'aperçu actuel.
- Dossier `installation` : image multi-stage Node/Python, Compose MongoDB authentifié/non exposé, Caddy HTTPS autorité locale, volumes persistants ; scripts Bash/PowerShell générant un mot de passe local aléatoire, mode configuration seule.
- `INSTALLATION_LOCALE.md` décrit réseau VM, hosts, certificat public à approuver Windows/Ubuntu, clé des intégrations facultatives, limites, démarrage/arrêt/mise à jour. Le serveur local démarre sur une base vide, aucune donnée d'aperçu transférée.
- `scripts/export_source.py` fabrique `dist/glycosoin-source.zip`, sources seulement (pas .env, données, tests/jetons, git, dépendances ou caches), avec refus des formats de secrets connus.
- Compilation web et TypeScript réussis ; lints Python et JS OK. Rapport `iteration_9.json` : 12/12 tests API/static/archive/régressions réussis + UI 390/320/1440 sans overflow. Identité jetable supprimée. Événements d'acceptation/refus de l'installation simulés dans les tests, pas d'installation OS réalisée.
- Seul point remonté corrigé : icônes PNG 192/512 ajoutées au manifeste (en plus du SVG), générateur reproductible `scripts/generate_pwa_icons.py`. Export refait, 12/12 tests repassés (`pytest/iteration11_final.xml`), archive 101 fichiers. Vérification navigateur réelle : PNG 200/dimensions exactes, `Page.getInstallabilityErrors` renvoie une liste vide sur l'aperçu HTTPS. Ce diagnostic ne valide pas les certificats locaux ni l'installation sur le PC de l'utilisateur.
- Dépendances : résolution propre a révélé un conflit pip de référence URL LiteLLM avec/sans checksum (même roue, mêmes versions). Diagnostic confirmé. Docker installe désormais le verrouillage complet avec `--no-deps`, puis `pip check`, sans retirer le checksum ni changer les versions. Installation VRAIE dans `/tmp/glycosoin-clean-python` réussie, `No broken requirements found.` ; image Docker complète toujours non construite ici.
- Limites : Docker absent du conteneur de développement, pas d'accès au PC/VM utilisateur. Validation réelle Docker/certificat/Google local requise ; disponibilité hors environnement des intégrations gérées non garantie. Notifications natives pas disponibles dans PWA, affichage des horaires seulement.

## Backlog priorisé
- **P0** : aucun échec dans le périmètre testé ; compte réel non effacé.
- **P1** : lancer l'installation Docker sur la VM, configurer réseau/certificats Windows et Ubuntu, valider Google et intégrations sur cette origine locale ; validation de la suppression/nettoyage natif sur téléphone ; streaming des réponses de l'assistant.
- **P2** : export complet CSV ; widgets ; coordination distribuée de l'effacement si le backend passe à plusieurs workers.

## Notes
- Synchro CGM réelle et OAuth Google : testables pleinement après connexion des comptes / build natif.
- Rappels : chargement protégé dans Expo Go Android (module non supporté) ; validation des notifications locales et de leur nettoyage requise en app native. Pas de push distant.
- L'IA fournit des informations générales, jamais de dose d'insuline précise ; ne remplace pas un avis médical.
