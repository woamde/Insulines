#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## Itération 3 (2026-06) — main agent
- Bug "Non authentifié" (CGM) : cause = gate d'auth par redirection ignorée sur Expo Go → écran capteur accessible sans session. Fix : `Stack.Protected` déclaratif dans `app/_layout.tsx` + relecture du jeton persistant dans `apiFetch` (`src/session.ts`).
- LibreLinkUp durci (`backend/cgm.py`) : Session + cookies, UA iOS, product llu.ios, version auto (status 920 → minimumVersion), cache du ticket (`libre_auth`), détection Cloudflare/HTML, messages d'erreur détaillés, statuts 2/4/429/430, steps tou/pp/verifyDob/verifyEmail.
- Nouveau `backend/tracking.py` : `/api/insulin` (POST/GET/DELETE, kind basale|bolus|correction), `/api/weight` (POST/GET/DELETE, met à jour profile.weight_kg), `/api/reminders` (GET défauts / PUT).
- Nouveau `backend/report.py` : `GET /api/report/pdf?days=90&tz=Europe/Paris` → PDF reportlab (patient, synthèse, TIR, courbe, insuline, poids, détail journalier).
- `/api/stats` : + basal_total, bolus_total, basal_daily_avg, weight_start/end/delta/count. Mongo client tz_aware=True.
- Frontend : écrans `ajouter-insuline`, `ajouter-poids`, `rappels` (expo-notifications locales, DAILY), `DoctorReport` dans Stats (expo-file-system + expo-sharing), journal filtres Insuline/Poids, accueil ligne basale + menu FAB étendu, profil liens Rappels/Poids.
- Test : token `devtest_token_123` (voir memory/test_credentials.md).

## Itération 4 (2026-06) — main agent
- Diagnostic "Non authentifié" persistant : logging UA sur 401 sans jeton (`auth.py`), à corréler avec le test utilisateur.
- Objectifs perso : profil `target_low`/`target_high`/`tir_goal` (validation 40<=low<high<=300, 1..100) ; `/api/stats` renvoie target_low/high/tir_goal et calcule hypo/hyper/TIR avec ces bornes ; PDF idem ; frontend zones (accueil, journal, ajout glycémie) + carte TIR Stats (badge objectif) + carte "Objectifs personnels" dans Profil.
- E-mail médecin : profil `doctor_name`/`doctor_email` (validé) ; `POST /api/report/email?days=&tz=` envoie le PDF en pièce jointe via Emergent Resend au destinataire **côté serveur** (profil), template fixe, limite 5/jour (`report_emails`), 400 si e-mail absent, 429 si limite. Bouton "Envoyer à mon diabétologue" dans la carte rapport (Stats).

## Itération 5 (2026-06) — main agent
- Unité mmol/L : `profile.glucose_unit` (mgdl|mmol, validé) ; stockage toujours mg/dL ; conversion affichage/saisie via `src/units.ts` (accueil, journal, stats, saisie glycémie, calculateur, repas, profil avec bascule `unit-mgdl`/`unit-mmol` qui convertit ISF/cible/plage).
- Activité physique : `/api/activity` POST/GET/DELETE (types marche|course|velo|natation|musculation|autre, intensité legere|moderee|intense, durée 5–600), GET renvoie `effect` (moyenne 2 h avant / 2 h après, delta, hypo_after). Écran `ajouter-activite`, journal filtre Activité, accueil menu FAB + flux, Stats : bandes bleues sur la courbe (GlucoseChart temps réel avec `markers`) + compteur ; PDF section activité ; stats `activity_count/minutes`.
- Partage proche : `/api/share` POST (label, max 5 actifs, token urlsafe 24) / GET / DELETE ; `GET /api/shared/{token}` PUBLIC (sans auth) → owner_name, latest, summary_24h, series, targets, unit ; 404 si révoqué/inconnu ; compteur de vues. Écran `partage` (créer/copier/partager/révoquer) et route publique `proche/[token]` hors Stack.Protected (accessible sans session).

## Itération 6 (2026-06) — main agent
- Constat logs : connexion Google RÉUSSIE depuis Android (compte Gmail, 16:02) sur le preview ; sync Libre à 16:03 → Abbott (api-fr) répond status 2 « incorrect username/password » pour le compte free.fr. Le message « Non authentifié » ne peut provenir que de l'ancien APK (pré-auth).
- Ajout `POST /api/cgm/test` (teste des identifiants sans enregistrer, renvoie le verdict du fournisseur + nb de mesures) ; bouton « Tester les identifiants » + encadré résultat + check-list LibreLinkUp (4 étapes) dans `app/cgm.tsx` ; message status 2 enrichi (compte LibreLinkUp ≠ LibreLink/LibreView, espaces, mot de passe LibreLinkUp).

## Itération 7 (2026-06) — main agent
- **CRASH Expo Go Android corrigé** : l'import statique d'`expo-notifications` lève une erreur dans Expo Go Android (SDK 53+) et faisait planter toute l'app au démarrage (route rappels). `src/notifications.ts` charge désormais le module paresseusement (require guardé) et `notificationsSupported=false` sur Expo Go Android (message explicatif dans l'écran Rappels).
- Import LibreView : `POST /api/import/libreview` {lines[], tz, batch_index} (≤6000 lignes/lot, en-tête répété) → parse FR/EN, mg/dL ou mmol/L, types 0/1 glycémie, bandelette, insuline rapide→bolus / lente→basale, glucides→repas ; dédoublonnage (minute+valeur). Écran `import-libreview` (expo-document-picker, lots de 4000 lignes, progression, résumé) ; lien dans Profil.
- Alerte hypo proche : `share_links.alert_email` (POST /api/share accepte alert_email, PATCH /api/share/{id}) ; `notify_hypo_if_needed` appelé après POST /api/glucose et après sync CGM (dernière mesure) : e-mail Resend si valeur < target_low, mesure < 2 h, 1 alerte max/heure/lien (`last_alert_at`, `alerts_sent`). UI dans `partage.tsx` (champ à la création + édition par lien).

## Itération 8 (2026-06) — main agent — bug login Google sur build déployée
- Cause probable : `user_sessions.session_token` a un index UNIQUE et `POST /api/auth/session` faisait un `insert_one` → DuplicateKeyError (500) quand Emergent renvoie le même session_token pour une reconnexion (cas fréquent après redéploiements) → échec silencieux du login sur l'APK alors que la 1re connexion (preview) passait.
- Fix : `auth.persist_session()` idempotent (upsert utilisateur par e-mail normalisé, upsert session par jeton, gestion DuplicateKeyError). Testable directement : `python /tmp/dup_test.py` (2 appels même token → 1 session, même user).
- Frontend : `signIn()` renvoie `{status, error}` avec le détail serveur ; l'écran login affiche « Connexion Google refusée : <detail> » au lieu d'un échec muet.
- Ajout modèles GPT-5.4 / GPT-5.4 mini dans `TEXT_MODELS` (ai.py) — liste `/api/ai/models` à mettre à jour.
- (it. 8 suite) Coach IA : `GET /api/ai/coach?days=&model=` → JSON {overview, insulin[], food[], activity[], patterns[], doctor_questions[], alert} construit à partir d'un digest chiffré (par moment de la journée, insuline basale/bolus, repas avec glycémie 2 h après, activités avec effet, poids) ; sauvegardé dans `ai_coach_reports` ; 400 si < 5 glycémies. Modèles : Claude, GPT-5.4/mini (nouveau), Gemini. Écran `app/coach.tsx` (période 7/14/30/90, choix IA, sections), carte « Coach IA » sur l'accueil.
- Rappel recontrôle hypo : `scheduleHypoRecheck(15)` (notification locale TIME_INTERVAL) appelé après saisie d'une glycémie < cible basse ; bannière accueil `hypo-recheck-banner` si dernière glycémie < cible basse et < 60 min.
- Libre multi-patients : `/api/cgm/test` renvoie `patients[]` + `selected_patient` ; écran CGM propose le choix (`cgm-patient-card`) et enregistre `patient_id`.

## Itération 11 — suppression de compte — main agent
- implemented: true ; needs_retesting: true ; working: NA
- Utilisateur : « le prototype via expo go fonctionne bien maintenant » ; préserver OAuth et CGM.
- Backend : `/api/auth/account` DELETE, confirmation SUPPRIMER, session obligatoire, interdit un user_id fourni par client. Purge de toutes les données user_id (soft deleted inclus), photos par écrasement zéro octet via stockage réel sans API DELETE, sessions, utilisateur. Registre uploads avant envoi ; isolation des photos rattachées. Barrière anti-écriture concurrente pendant suppression, drapeau persistant + reprise après échec.
- Frontend : Profil lien suppression, écran supprimer-compte, checkbox explicite, export optionnel, annulation, blocage double soumission, erreur visible, succès login ; jeton/caches/rappels/fichiers locaux nettoyés. Google et compte LibreLinkUp ne sont pas supprimés.
- test_plan: auth obligatoire, absence/mauvaise confirmation (422), isolation A/B, toutes collections, photos upload+repas et photo abandonnée, anciennes photos liées aux repas, échec stockage/reprise (test isolé), requêtes concurrentes, tous tokens invalidés, partage/photo 404 après, reconnexion fraîche sans anciennes données, UI annuler/puis supprimer/erreur/réessayer/login, responsive 390/320, régression dashboard/profil/cgm.
- agent_communication: Créer des comptes JETABLES dédiés et renseigner memory/test_credentials.md ; ne JAMAIS effacer les comptes réels ou anciens comptes de test partagés. Ne pas appeler Abbott avec des identifiants factices ni réutiliser des identifiants enregistrés d'un vrai utilisateur. Tester le stockage réel pour les octets effacés ; simuler uniquement les erreurs dans les tests isolés. Confirmer explicitement les limites du test natif.
- Résultat `iteration_8.json`: 4/4 scénarios backend et parcours mobile web 390/320 réussis. Pas de bug produit signalé. À valider encore sur téléphone : OAuth natif et nettoyage notifications/caches/fichiers.
- Correctif de teardown des tests : inclure l'identité nouvellement recréée après suppression dans le nettoyage (pas une modification produit). La suggestion générique de retirer le repli STORAGE_BASE n'est pas appliquée car le playbook officiel impose ce repli lorsque la variable proxy est vide.

## Phase 12 — installation locale Windows/Ubuntu — main agent
- implemented: true; needs_retesting: true
- Web Expo export production construit (`frontend/dist`), URL API same-origin via export-local-web.mjs ; URL preview/.env ignorées uniquement pour cet export. Native inchangé.
- Manifeste + service worker public-only, aide installer (Windows/Ubuntu), hors connexion informatif sans données médicales en cache. API responses no-store. Mutations web non mises en attente offline.
- Local static backend gated WEB_DIST_DIR; install Compose Mongo+app+Caddy HTTPS + scripts start.sh/start.ps1 + guide. Docker n'est PAS disponible ici : ne pas prétendre avoir lancé les conteneurs sur Windows/VM.
- Archive source-only générée (`dist/glycosoin-source.zip`), secrets/données/jetons de test exclus. Refaire après les derniers changements.
- Pré-test : tsc + lint OK ; screenshot login/aide ouverture fermeture 390 px OK. Tester UI desktop/mobile, manifeste/installability/SW privacy/offline, export same-origin, API/static fallback/path traversal/no-cache, archive complet sans secrets, regression compte/CGM sans vrais comptes. Compte jetable seulement.
- Rapport iteration_9 : 12/12 scénarios API/static/archive passent ; UI sans overflow. Point corrigé par main : PNG 192/512 ajoutés au manifeste, vrais fichiers décodés dans le navigateur (HTTP200), CDP Page.getInstallabilityErrors=[] sur HTTPS preview. 12/12 tests repassent après export/rebuild archive (iteration11_final.xml).
- L'installation OS a seulement été simulée par événements lors des tests UI, pas réellement exécutée. Les APIs métier ne sont pas simulées. Docker/PowerShell et retour Google privé restent à valider par l'utilisateur sur ses machines.
- Main follow-up : conflit du résolveur pip sur roue LiteLLM URL+checksum vs URL sans checksum corrigé côté Dockerfile par installation du freeze complet `--no-deps` + vérification obligatoire `pip check`. Aucune version ni somme de contrôle modifiée. Installation réelle dans un venv neuf réussie, `No broken requirements found.`.
