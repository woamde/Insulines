# GlycoSoin T1D sur Windows 11 et Ubuntu

Ce projet conserve l'application mobile Expo et ajoute une **application web
installable (PWA)**. Ce n'est pas un fichier `.exe` ni une application autonome
hors ligne. Le code de toutes les fonctionnalités est présent ; certaines
nécessitent des services externes et les rappels natifs restent réservés au mobile.

## 1. Architecture conseillée

```text
Windows 11 (Edge/Chrome) ─┐
                        ├─ HTTPS → VM Ubuntu : Caddy → FastAPI + interface web
Ubuntu (Chrome/Chromium) ┘                               └─ MongoDB local
```

Les deux navigateurs utilisent la **même adresse** et le même compte Google pour
voir les mêmes données. La VM doit rester allumée. Installer la PWA sur Windows
n'installe pas une deuxième base. Les données existantes de l'aperçu ne sont **pas
copiées** : la nouvelle base démarre vide. L'import CSV LibreView reste disponible.

Utilisez une VM reliée au réseau privé de l'hôte (adaptateur « host-only » ou
réseau privé accessible). Une VM en NAT sans accès entrant ne sera pas joignable
directement depuis Windows. Réservez une IP stable. **N'ouvrez aucun port sur votre
routeur Internet.** MongoDB n'expose aucun port sur Windows ou Ubuntu.

## 2. Récupérer les sources et prérequis

Récupérez votre dépôt via **Save to GitHub**, puis clonez-le. Les fichiers locaux
de secrets ne doivent pas être partagés. Ne copiez pas le MONGO_URL de l'aperçu :
la configuration ci-dessous crée sa propre base et son propre mot de passe.

- Ubuntu 22.04/24.04 : Docker Engine et plugin **Docker Compose v2 récent**.
- Windows 11, uniquement si vous souhaitez aussi héberger les serveurs sur Windows :
  Docker Desktop avec moteur Linux/WSL2 activé.
- Pour utiliser Windows comme simple client de la VM : **Edge ou Chrome suffit**.
- Prévoyez plusieurs Go d'espace libre ; la première compilation télécharge Node,
  Python, les dépendances et MongoDB. Internet est requis pour cette étape.

Vérifiez `docker version` et `docker compose version`. N'exécutez pas les serveurs
de développement Expo pour l'installation finale : le conteneur compile un export.

## 3. Préparer la VM Ubuntu

Depuis la racine du projet :

```bash
bash installation/start.sh --configure-only
nano installation/.env
```

Le script crée un mot de passe MongoDB aléatoire ; conservez-le. Réglez :

```dotenv
APP_HOST=glycosoin.home.arpa
# Exemple SEULEMENT : remplacer par l'IP privée réelle de votre VM.
BIND_ADDRESS=192.168.56.101
```

`APP_HOST` est un nom d'hôte **sans** https://, chemin ni port. Laissez les ports
HTTP/HTTPS par défaut si disponibles. Le port interne de l'API est configurable
avec API_PORT ; le serveur utilise **un worker** pour coordonner les suppressions.

Les champs optionnels EMERGENT_LLM_KEY (IA et stockage photos) et
EMERGENT_EMAIL_KEY (e-mails) sont volontairement vides. Renseignez vos propres
clés côté serveur pour ces options. Ne les placez jamais dans le frontend,
le manifeste ou une variable EXPO_PUBLIC_. Les identifiants CGM se saisissent
dans l'application, pas dans les fichiers distribués.

```bash
bash installation/start.sh
```

La première compilation peut être longue. Un succès indique que les conteneurs
sont démarrés ; il reste le certificat et le nom local ci-dessous.

## 4. Faire reconnaître le nom et HTTPS sur les deux machines

### Nom local

Ajoutez une ligne avec **l'IP réelle de la VM** :

```text
192.168.56.101 glycosoin.home.arpa
```

- Windows : éditez `C:\Windows\System32\drivers\etc\hosts` avec le Bloc-notes
  lancé en administrateur.
- Ubuntu : `sudo nano /etc/hosts`.

### Certificat

Caddy génère une autorité locale propre à votre installation. Exportez **uniquement
son certificat public**, jamais les fichiers `.key` :

```bash
cd installation
docker compose --env-file .env -f compose.yaml cp gateway:/data/caddy/pki/authorities/local/root.crt ./glycosoin-root.crt
```

Transférez ce certificat de manière sûre à Windows. Ne faites confiance qu'au
certificat de **votre** installation : une autorité racine est une autorisation
sensible, pas un fichier à récupérer d'un tiers au hasard.

- Windows : importez-le dans les « Autorités de certification racines de confiance »
  du compte utilisateur, ou dans un terminal :
  `certutil -user -addstore Root glycosoin-root.crt`.
- Ubuntu : copiez-le dans `/usr/local/share/ca-certificates/glycosoin-root.crt`,
  puis exécutez `sudo update-ca-certificates`. Selon votre navigateur, importez-le
  aussi dans son gestionnaire de certificats (autorités locales approuvées).

Fermez puis rouvrez le navigateur après l'import. Ouvrez
**https://glycosoin.home.arpa**. Il ne doit plus y avoir d'avertissement de
certificat. Ne contournez pas les avertissements : l'installation PWA demande
un contexte sécurisé reconnu. Si vous avez choisi un autre port HTTPS,
ajoutez `:votre-port` à l'adresse.

## 5. Installer l'application

- **Windows 11** : dans Edge ou Chrome, cliquez sur l'icône d'installation dans
  la barre d'adresse, ou dans le menu Applications / Installer ce site.
- **Ubuntu** : même opération dans Chrome ou Chromium (Firefox Linux n'offre
  pas ce parcours d'installation de bureau nativement).
- Le bouton **Installer l'application** en haut de GlycoSoin affiche l'aide et
  propose l'invite native du navigateur lorsqu'elle est disponible.

Connectez-vous avec Google, puis ouvrez votre profil. Le fournisseur de connexion
doit accepter le retour vers votre adresse locale HTTPS ; ce flux réel doit être
vérifié depuis votre ordinateur. L'export du code ne constitue pas une garantie
d'accès aux services gérés hors de leur environnement d'origine. Aucun compte
de démonstration, mot de passe fixe ou contournement d'authentification n'est fourni.

## 6. Ce qui fonctionne localement, et ce qui dépend d'Internet

| Fonction | Dépendances / limites |
| --- | --- |
| Journal, profil, glycémies, repas, calculateur, stats, poids, sport | FastAPI + MongoDB locaux, session Google valide |
| PDF médecin | Génération locale, téléchargement par le navigateur |
| Import LibreView CSV | Fichier local envoyé au serveur local |
| Partage proche | Lien valide seulement pour les appareils qui joignent votre serveur privé |
| Suppression du compte | Purge locale + effacement des photos via le stockage géré ; connexion au stockage nécessaire si photos |
| Google | Service d'authentification en ligne ; retour OAuth local à valider |
| LibreLinkUp, Dexcom, Nightscout | Accès au fournisseur/instance et identifiants réels |
| IA, analyse de repas, coach | Clé et service IA en ligne |
| Photos enregistrées | Stockage objet géré actuel, **pas stockées dans le volume MongoDB local** |
| Rapport/alertes par e-mail | Clé et service e-mail en ligne |
| Rappels et recontrôle après hypo | **Notifications natives non disponibles dans la PWA** ; horaires éditables seulement |
| Hors connexion | Page d'information uniquement ; aucune nouvelle saisie, pas de journal médical en cache |

La PWA ne remplace pas le lecteur de glycémie ni les alarmes de votre capteur.
Le service worker ne conserve que la page hors connexion, le logo et le manifeste.
Il ne met en cache ni `/api`, ni les sessions, ni les photos, ni les rapports.
Un écran déjà ouvert peut encore afficher des données anciennes : une bannière
le signale si le navigateur perd la connexion. Les écritures hors ligne échouent
sans mise en file d'attente automatique.

## 7. Arrêt, redémarrage et mise à jour

Depuis `installation` :

```bash
docker compose --env-file .env -f compose.yaml ps
docker compose --env-file .env -f compose.yaml logs --tail=100 app gateway
docker compose --env-file .env -f compose.yaml stop
docker compose --env-file .env -f compose.yaml start
```

Pour une mise à jour, récupérez les nouvelles sources puis relancez start.sh.
Fermez toutes les fenêtres GlycoSoin et rouvrez-les pour charger la nouvelle
version du service worker. Aucun rafraîchissement forcé automatique ne coupe une saisie.

Les volumes Docker conservent les données et certificats. **N'utilisez pas
`docker compose down -v`**, qui les effacerait. Ne changez pas le mot de passe
MongoDB de `.env` après initialisation sans effectuer une rotation réelle dans
MongoDB : les variables d'initialisation ne modifient pas un volume existant.
Sauvegardez le volume MongoDB de façon chiffrée et testez sa restauration avant
d'utiliser l'installation pour des données importantes. Une suppression dans
l'app ne supprime pas automatiquement vos sauvegardes externes.

## 8. Hébergement sur Windows au lieu de la VM (facultatif)

Depuis PowerShell, à la racine du projet :

```powershell
powershell -ExecutionPolicy Bypass -File .\installation\start.ps1 -ConfigureOnly
# Modifiez installation\.env si nécessaire.
powershell -ExecutionPolicy Bypass -File .\installation\start.ps1
```

L'option ExecutionPolicy s'applique uniquement à ce processus ; vérifiez le script
avant de l'exécuter. Gardez BIND_ADDRESS=127.0.0.1 pour un usage limité à ce PC,
et associez `127.0.0.1 glycosoin.home.arpa` dans son fichier hosts. Suivez ensuite
les étapes du certificat. Cela crée une base distincte de celle de la VM : pour
partager les mêmes données, n'hébergez qu'un seul serveur.

## 9. Code complet et archive sans secrets

Le dépôt contient `frontend` (Expo mobile/web), `backend` (toutes les API/options),
`installation` (lancement local), et ce guide. Pour créer une archive distribuable :

```bash
python3 scripts/export_source.py
```

Sous Windows utilisez `python scripts/export_source.py`. Le résultat est
`dist/glycosoin-source.zip`. Le script exclut les secrets, les données, les jetons
de test, l'historique Git, les caches et les dépendances réinstallables.
Les exemples `.env.example` contiennent uniquement des valeurs factices.

## 10. Vérifications avant usage réel

1. HTTPS reconnu, manifeste chargé, application installable dans le navigateur.
   Dans les outils du navigateur (F12), onglet Application → Manifest : vérifier
   le nom GlycoSoin et les icônes PNG 192/512 sans erreur. Onglet Service Workers :
   vérifier que `/sw.js` contrôle l'adresse de votre installation.
2. Connexion Google réelle et retour au tableau de bord sur les deux ordinateurs.
3. Ajouter une glycémie **de test**, la retrouver depuis le deuxième ordinateur,
   puis la retirer. Vérifier l'heure affichée.
4. Tester chaque intégration activée avec vos comptes : capteur, IA, photo, e-mail.
5. Vérifier le PDF et la persistance après redémarrage des conteneurs.
6. Tester la suppression avec un **compte jetable**, jamais votre compte principal.

Les tests de l'agent valident le code et l'export dans son environnement. Ils ne
remplacent pas le lancement Docker, la confiance du certificat et le test OAuth
sur votre PC/VM, auxquels l'agent n'a pas accès.

### Note sur les dépendances Python

`backend/requirements.txt` est un verrouillage complet (dépendances transitives
incluses). L'image installe exactement ces versions avec `--no-deps`, puis exécute
`pip check` : toute dépendance absente ou incompatible bloque la construction.
Cela évite un conflit du résolveur pip entre deux références à la même roue
LiteLLM (avec/sans fragment de checksum), tout en conservant la vérification du
checksum fourni. Aucune version de bibliothèque n'a été changée pour ce contournement.