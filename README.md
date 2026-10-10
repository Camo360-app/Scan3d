# Scan3D — étape 1 : la capture

Deux versions, avec le même code :

- **Favori web** (on commence par celle-ci). S'ouvre dans Safari et s'ajoute à
  l'écran d'accueil. Pas d'App Store, rien à payer à Apple. Voir « Version favori web » plus bas.
- **App iPhone** (pour plus tard). Nuage de points en direct avec ARKit. Voir la suite de ce guide.

## Version favori web

Safari ne donne pas accès à ARKit. Le favori prend donc des **photos guidées** :

1. **Nouveau scan** → **Démarrer**. Safari demande la caméra, puis les « mouvements » : accepter les deux.
2. Tourne lentement autour de l'objet. Une photo est prise toute seule à chaque 8° de rotation, seulement quand le
   téléphone est assez stable (photo nette).
3. Les 3 anneaux en haut à droite montrent ce qui est couvert : un tour bas, un tour au milieu, un tour de haut.
4. **Terminer**, puis **Exporter** : un fichier `.zip` (photos + `scan.json`). Sur iPhone, la feuille de partage
   s'ouvre : « Enregistrer dans Fichiers », AirDrop ou courriel.

Les photos restent dans le téléphone (stockage de Safari) jusqu'à l'export. Les positions exactes de la caméra seront
calculées par la reconstruction (étape suivante). `scan.json` garde l'orientation du téléphone, à titre indicatif.

Essayer sur le PC :

```powershell
npm install
npm run web
```

Ça ouvre la page dans le navigateur (la caméra du PC remplace celle de l'iPhone).

Construire le site à mettre en ligne :

```powershell
npm run build:web
```

Le site est dans le dossier `dist`. Il doit être servi en **https** (sinon, pas de caméra dans Safari).

### En ligne : GitHub Pages

Scan3D n'a aucune donnée personnelle : pas de connexion, pas d'Azure, pas de serveur. À chaque envoi sur `main`, `.github/workflows/pages.yml` construit le site et le met en ligne tout seul.

- Adresse : https://camo360-app.github.io/Scan3d/
- Sur l'iPhone : ouvrir l'adresse dans Safari → bouton Partager → **Sur l'écran d'accueil**.

App iPhone (Expo, React Native, TypeScript). Tu tournes autour d'un objet. L'app montre la caméra et le nuage de
points en direct. Elle garde les **images clés** et la **position de la caméra** de chacune, pour reconstruire l'objet
en 3D plus tard.

- Pas besoin de LiDAR. Il faut un iPhone avec ARKit (iPhone 6s ou plus récent).
- Pas de Mac non plus : l'app est construite dans le nuage d'Expo (**EAS Build**).

## Ce qu'il faut avant de commencer

1. **Un compte Apple Developer** (99 $ US par année) : https://developer.apple.com/programs/
   Sans lui, Apple refuse d'installer une app maison sur un iPhone.
2. **Un compte Expo** (gratuit) : https://expo.dev/signup
3. Sur Windows :
   - **Node.js** version LTS : https://nodejs.org (garde les choix par défaut).
   - **Git** : https://git-scm.com/download/win (choix par défaut).
4. Sur l'iPhone : l'app **Appareil photo** et le même Wi-Fi que l'ordinateur.

## Les commandes, une par une

Ouvre **PowerShell** (touche Windows, tape « PowerShell », Entrée).

### 1. Vérifier Node

```powershell
node -v
```

Ça affiche un numéro (ex. `v22.…`). Sinon, réinstalle Node.js.

### 2. Récupérer le projet

```powershell
cd $HOME\Documents
git clone https://github.com/Camo360-app/Scan3d.git
cd Scan3d
```

- `cd` = « aller dans le dossier ».
- `git clone` copie le projet sur ton PC (une seule fois).

### 3. Installer les morceaux du projet

```powershell
npm install
```

Télécharge les bibliothèques (dossier `node_modules`). 1 à 3 minutes. Des « warn » jaunes, c'est normal.

### 4. Installer l'outil EAS et te connecter

```powershell
npm install -g eas-cli
eas login
```

- `-g` = installé pour tout l'ordinateur.
- `eas login` demande ton courriel et ton mot de passe **Expo**.

> Si PowerShell dit « l'exécution de scripts est désactivée » : lance une fois
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, réponds `O`, puis recommence.

### 5. Lier le projet à ton compte Expo

```powershell
eas init
```

Réponds **Oui** pour créer le projet. EAS ajoute un identifiant dans `app.json`. C'est normal.

### 6. Enregistrer ton iPhone

```powershell
eas device:create
```

- Choisis **Website** : un lien et un code QR s'affichent.
- Scanne le QR avec l'appareil photo de l'iPhone, puis installe le **profil** proposé
  (Réglages → Profil téléchargé → Installer).
- Ça donne à Apple le numéro de ton iPhone. Une seule fois par iPhone.

### 7. Construire l'app (dans le nuage)

```powershell
eas build --profile development --platform ios
```

- EAS demande ton **identifiant Apple** : réponds oui et connecte-toi. Il crée les certificats tout seul.
- Le build prend 10 à 25 minutes. Tu peux fermer PowerShell : le lien vers le build reste sur https://expo.dev.
- À la fin : un code QR. Scanne-le avec l'iPhone → **Installer**.

À refaire **seulement** quand le code natif change (le dossier `modules/`, `app.json` ou une nouvelle bibliothèque).

### 8. Activer le mode développeur sur l'iPhone (une seule fois)

Réglages → Confidentialité et sécurité → **Mode développeur** → activer → l'iPhone redémarre → confirmer.
(L'option apparaît après l'installation de l'app.)

### 9. Lancer l'app

Sur le PC :

```powershell
npm start
```

- Un code QR s'affiche. Scanne-le avec l'iPhone : Scan3D s'ouvre et charge l'app depuis ton PC.
- Si Windows demande d'autoriser Node.js sur le réseau : **Autoriser** (réseau privé).
- Si ça ne se connecte pas : `npx expo start --dev-client --tunnel`.

Quand tu changes un fichier `.tsx` et que tu sauvegardes, l'iPhone se met à jour tout seul. Pas besoin de rebuild.

## Utiliser l'app

1. **Nouveau scan**.
2. Bouge doucement le téléphone jusqu'au point vert.
3. **Démarrer**, puis tourne lentement autour de l'objet (2 ou 3 tours à des hauteurs différentes).
4. **Terminer**. Le scan est enregistré.

Conseils : bonne lumière, objet avec des motifs (pas tout blanc, pas brillant), fond avec des détails.

## Où sont les fichiers du scan

Sur l'iPhone : app **Fichiers** → Sur mon iPhone → **Scan3D** → `scans` → `scan-AAAAMMJJ-HHMMSS` :

| Fichier | Contenu |
|---|---|
| `images/frame_00001.jpg` … | Les images clés (en paysage, comme le capteur les voit) |
| `transforms.json` | La position de la caméra pour chaque image + focale et centre optique (format Nerfstudio) |
| `points.ply` | Le nuage de points (s'ouvre dans MeshLab, CloudCompare ou Blender) |
| `scan.json` | Résumé : date, nombre d'images et de points |

Une image clé est prise quand le téléphone a bougé de 7 cm ou tourné de 10°, au plus 4 par seconde, et seulement quand
le suivi est bon (point vert).

## Comment le projet est rangé

```
scan3d/
  app.json            nom, identifiant iPhone, texte de permission caméra
  eas.json            profils de build (development = installable sur ton iPhone)
  src/app/index.tsx   écran d'accueil (bouton « Nouveau scan », liste des scans)
  src/app/capture.tsx écran de capture, app iPhone (ARKit)
  src/app/capture.web.tsx écran de capture, favori web (photos guidées, anneaux)
  src/storage/        scans enregistrés (scans.web.ts : dans Safari, export .zip)
  public/             icône et manifeste du favori web
  modules/scan3d-ar/  module natif Swift (Expo Modules API)
    ios/Scan3dArModule.swift  ce que JavaScript peut appeler
    ios/Scan3dArView.swift    caméra ARKit, nuage de points, images clés
    ios/ScanStorage.swift     écriture des fichiers
```

## Problèmes fréquents

- **« No development build installed »** ou écran rouge « Scan3dAr not found » : l'app vient d'Expo Go. Utilise
  l'app **Scan3D** installée à l'étape 7.
- **Le build échoue « Apple account »** : vérifie que l'abonnement Apple Developer est actif.
- **Nouvel iPhone** : refais l'étape 6, puis l'étape 7.
