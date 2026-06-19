# Ombres d'Avan ⚔️

Jeu de **gestion stratégique & idle RPG médiéval Dark Fantasy** jouable directement dans le navigateur (HTML5 Canvas, sans installation).

## ▶️ Jouer

**https://bodji27200-web.github.io/ombres-davan/**

Fonctionne sur PC, mobile et **console (Edge / Xbox)**.

## 🎮 Contrôles

- **Glisser la souris** ou **flèches / ZQSD** : déplacer librement la caméra sur la carte
- **Clic sur un héros** : sélection (cercle bleu) → **clic sur un camp ennemi** → *Envoyer*
- Barre bas-droite : ⚑ Taverne (recruter), ☥ Héros, ⌂ recentrer, ❖ sauvegarder
- Après une victoire : ouvrir le **Coffre** (bas-droite) pour récupérer Or + XP

## ✨ Contenu (Vertical Slice)

- Carte ouverte avec **caméra libre** et village vivant (fumées, lumières, villageois autonomes)
- **Économie logistique réelle** : Scierie + Mine produisent, un **chariot** fait les allers-retours et livre au village
- **Héros uniques** générés aléatoirement (nom, portrait, classe, talent passif, Agilité, niveau & XP)
- **Combat automatique** sans grille : ordre d'action par Agilité, animations de percussion, IA comportementales, textes de dégâts flottants
- **Coffre de Victoire** distribuant Or & XP, montées de niveau, nouvelles compétences
- **Sauvegarde automatique** (LocalStorage) + gains hors-ligne
- 4 difficultés (Facile → **Hardcore**)

## 🛠️ Architecture

Vanilla JS, sans dépendances ni build. Fichiers chargés en `<script>` classiques sur un namespace global `Game` :

| Fichier | Rôle |
|---|---|
| `index.html` / `style.css` | Structure + thème Dark Fantasy gothique |
| `entities.js` | Héros, ennemis, bâtiments, chariots, formules, portraits procéduraux |
| `world.js` | Carte, caméra libre, rendu, interactions |
| `combat.js` | Combat automatique (ATB par Agilité) |
| `save.js` | Sauvegarde LocalStorage + hors-ligne |
| `game.js` | Boucle de jeu, économie, UI, orchestration |

## 📝 Note

Projet personnel inspiré de la boucle macro de *Champions of Avan*. Tout le rendu est dessiné au Canvas (aucun asset externe).
