/* =================================================================
   entities.js — Données, formules et classes du jeu
   Attache tout à window.Game.Entities (+ Game.RNG, Game.Art)
   ================================================================= */
(function (Game) {
  "use strict";

  /* -------------------- RNG seedé (mulberry32) -------------------- */
  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  const RNG = {
    make: mulberry32,
    int: (rng, a, b) => Math.floor(rng() * (b - a + 1)) + a,
    pick: (rng, arr) => arr[Math.floor(rng() * arr.length)],
    chance: (rng, p) => rng() < p,
    seed: () => (Math.random() * 0xffffffff) >>> 0,
  };
  Game.RNG = RNG;

  /* -------------------- Formules de progression -------------------- */
  const F = {
    // XP requise pour passer du niveau "level" au suivant (courbe exponentielle).
    xpToNext: (level) => Math.round(100 * Math.pow(level, 1.8)),
    // Dégâts = max(1, Attaque - Armure)
    damage: (atk, arm) => Math.max(1, Math.round(atk) - Math.round(arm)),
    // Croissance définitive des stats par niveau (+15%).
    grow: (base, level, rate = 1.15) => base * Math.pow(rate, level - 1),
  };

  /* -------------------- Pools de génération -------------------- */
  const NAME_A = ["Bor", "Kael", "Thar", "Mor", "Eld", "Gru", "Syl", "Vael", "Dra", "Hen",
                  "Ulf", "Bran", "Cad", "Ren", "Var", "Aze", "Fenn", "Gor", "Lys", "Tor"];
  const NAME_B = ["win", "dric", "gar", "oth", "ena", "ius", "mar", "wyn", "dan", "ric",
                  "goth", "ven", "lis", "mund", "ka", "thas", "dor", "nel", "vok", "ra"];
  const EPITHETS = ["le Vaillant", "l'Ombre", "le Borgne", "des Cendres", "le Sombre",
                    "au Cœur de Fer", "le Hardi", "la Lame", "le Maudit", "le Loyal"];

  function genName(rng) {
    let n = RNG.pick(rng, NAME_A) + RNG.pick(rng, NAME_B);
    if (RNG.chance(rng, 0.5)) n += " " + RNG.pick(rng, EPITHETS);
    return n;
  }

  /* -------------------- Classes de héros -------------------- */
  // ai : comportement utilisé par combat.js
  const CLASSES = {
    guerrier: {
      name: "Guerrier", ai: "warrior", color: "#c9a05a",
      base: { hp: [38, 50], atk: [7, 10], arm: [3, 5], agi: [4, 7], heal: 0 },
      skills: [
        { lvl: 3, key: "garde", name: "Garde Inébranlable", desc: "Sous 35% PV : lève un bouclier (+4 armure 2 tours)." },
        { lvl: 6, key: "frappe_lourde", name: "Frappe Lourde", desc: "Coups +1 dégât." },
        { lvl: 10, key: "rempart", name: "Rempart", desc: "+3 armure permanente." },
      ],
    },
    assassin: {
      name: "Assassin", ai: "assassin", color: "#9b6fd0",
      base: { hp: [22, 30], atk: [9, 13], arm: [0, 2], agi: [13, 17], heal: 0 },
      skills: [
        { lvl: 3, key: "execution", name: "Exécution", desc: "Cible en priorité l'ennemi le plus faible." },
        { lvl: 6, key: "celerite", name: "Célérité", desc: "+2 agilité." },
        { lvl: 10, key: "coup_fatal", name: "Coup Fatal", desc: "Achève sous 15% PV." },
      ],
    },
    mage: {
      name: "Mage Soigneur", ai: "healer", color: "#5fa9d0",
      base: { hp: [24, 32], atk: [5, 8], arm: [1, 3], agi: [7, 11], heal: [5, 9] },
      skills: [
        { lvl: 3, key: "vague_soin", name: "Vague de Soin", desc: "Soigne le héros le plus blessé." },
        { lvl: 6, key: "benediction", name: "Bénédiction", desc: "+2 soin." },
        { lvl: 10, key: "renaissance", name: "Renaissance", desc: "Relève une fois un allié tombé." },
      ],
    },
  };

  /* -------------------- Talents passifs (1 par héros) -------------------- */
  const TALENTS = [
    { key: "dernier_souffle", name: "Dernier Souffle", desc: "Sous 20% PV : +30% armure." },
    { key: "soif_sang",       name: "Soif de Sang",    desc: "Soigne 2 PV à chaque coup porté." },
    { key: "berserk",         name: "Berserk",         desc: "Sous 50% PV : +25% attaque." },
    { key: "vif",             name: "Pas Léger",       desc: "+20% agilité." },
    { key: "cuirasse",        name: "Cuirassé",        desc: "+2 armure permanente." },
    { key: "cupide",          name: "Cupidité",        desc: "+15% d'or gagné en combat." },
  ];

  /* =================================================================
     HÉROS
     ================================================================= */
  class Hero {
    constructor(data) {
      this.id = data.id;
      this.seed = data.seed;
      this.classKey = data.classKey;
      this.name = data.name;
      this.level = data.level || 1;
      this.xp = data.xp || 0;
      this.base = data.base;               // stats de base au niveau 1
      this.talentKey = data.talentKey;
      this.unlockedSkills = data.unlockedSkills || []; // clés de skills débloqués
      // état monde
      this.pos = data.pos || { x: 0, y: 0 };
      this.wander = null;                  // cible d'errance
      this.state = data.state || "idle";   // idle | mission | fighting | wounded
      this.woundedUntil = data.woundedUntil || 0;
      // combat (transitoire)
      this.hp = this.maxHp;
      this.portrait = null;                // canvas (lazy)
    }
    get cls() { return CLASSES[this.classKey]; }
    get className() { return this.cls.name; }
    get color() { return this.cls.color; }
    get talent() { return TALENTS.find(t => t.key === this.talentKey); }

    get maxHp() { return Math.round(F.grow(this.base.hp, this.level)); }
    get atk()   { let a = F.grow(this.base.atk, this.level);
                  if (this.unlockedSkills.includes("frappe_lourde")) a += 1;
                  return Math.round(a); }
    get arm()   { let r = F.grow(this.base.arm, this.level);
                  if (this.talentKey === "cuirasse") r += 2;
                  if (this.unlockedSkills.includes("rempart")) r += 3;
                  return Math.round(r); }
    get agi()   { let g = F.grow(this.base.agi, this.level, 1.05) * (this.talentKey === "vif" ? 1.2 : 1);
                  if (this.unlockedSkills.includes("celerite")) g += 2;
                  return Math.round(g); }
    get heal()  { let h = this.base.heal ? F.grow(this.base.heal, this.level) : 0;
                  if (this.unlockedSkills.includes("benediction")) h += 2;
                  return Math.round(h); }

    // Ajoute de l'XP, gère les montées de niveau. Renvoie le récap pour l'écran de victoire.
    addXp(amount) {
      const res = { gained: amount, levelsUp: 0, newSkills: [] };
      this.xp += amount;
      let guard = 0;
      while (this.xp >= F.xpToNext(this.level) && guard++ < 100) {
        this.xp -= F.xpToNext(this.level);
        this.level++;
        res.levelsUp++;
        for (const sk of this.cls.skills) {
          if (sk.lvl === this.level && !this.unlockedSkills.includes(sk.key)) {
            this.unlockedSkills.push(sk.key);
            res.newSkills.push(sk);
          }
        }
      }
      if (res.levelsUp > 0) this.hp = this.maxHp; // soigné à la montée de niveau
      return res;
    }

    getPortrait() {
      if (!this.portrait) this.portrait = Game.Art.portrait(this.seed, 64, this.classKey);
      return this.portrait;
    }

    // Sérialisation
    toJSON() {
      return { id: this.id, seed: this.seed, classKey: this.classKey, name: this.name,
               level: this.level, xp: this.xp, base: this.base, talentKey: this.talentKey,
               unlockedSkills: this.unlockedSkills, pos: this.pos, state: this.state,
               woundedUntil: this.woundedUntil };
    }
  }

  function rollBase(rng, ranges) {
    const b = {};
    for (const k in ranges) {
      const r = ranges[k];
      b[k] = Array.isArray(r) ? RNG.int(rng, r[0], r[1]) : r;
    }
    return b;
  }

  let _heroId = 1;
  function makeHero(opts = {}) {
    const seed = opts.seed != null ? opts.seed : RNG.seed();
    const rng = RNG.make(seed);
    const classKey = opts.classKey || RNG.pick(rng, Object.keys(CLASSES));
    const cls = CLASSES[classKey];
    return new Hero({
      id: opts.id || ("h" + (_heroId++)),
      seed,
      classKey,
      name: opts.name || genName(rng),
      base: rollBase(rng, cls.base),
      talentKey: opts.talentKey || RNG.pick(rng, TALENTS).key,
      level: opts.level || 1,
      pos: opts.pos,
    });
  }

  /* =================================================================
     ENNEMIS
     ================================================================= */
  const ENEMY_TYPES = {
    soldat_korcha: { name: "Soldat Kor'Cha", family: "gobelins", ai: "sbire",
      hp: [9, 12], atk: [3, 4], arm: [0, 1], agi: [6, 9] },
    capitaine_korcha: { name: "Capitaine Kor'Cha", family: "gobelins", ai: "capitaine",
      hp: [26, 32], atk: [5, 6], arm: [1, 2], agi: [5, 7], captain: true },
    // Bêtes sauvages : rapides, focalisent la cible la plus fragile
    bete: { name: "Bête Sauvage", family: "betes", ai: "bete",
      hp: [18, 24], atk: [5, 8], arm: [0, 1], agi: [9, 13] },
    alpha_bete: { name: "Alpha de la Meute", family: "betes", ai: "capitaine",
      hp: [30, 38], atk: [6, 8], arm: [1, 2], agi: [8, 11], captain: true },
    // Morts-vivants : sans peur (ne fuient jamais)
    squelette: { name: "Squelette Pillard", family: "morts-vivants", ai: "sbire_undead",
      hp: [12, 16], atk: [3, 5], arm: [1, 2], agi: [5, 8] },
    // BOSS : Roi des Ossements (Enragé sous 40% PV + invoque des squelettes)
    roi_ossements: { name: "Roi des Ossements", family: "morts-vivants", ai: "boss",
      hp: [95, 115], atk: [7, 9], arm: [2, 3], agi: [5, 7], boss: true, summon: "squelette" },
  };

  let _enemyId = 1;
  class Enemy {
    constructor(data) {
      this.id = data.id;
      this.seed = data.seed;
      this.typeKey = data.typeKey;
      this.name = data.name;
      this.family = data.family;
      this.aiKey = data.aiKey;
      this.isCaptain = !!data.isCaptain;
      this.isBoss = !!data.isBoss;
      this.summonType = data.summonType || null;
      this.level = data.level || 1;
      this.base = data.base;        // {hp,atk,arm,agi}
      this.hp = this.maxHp;
      this.portrait = null;
    }
    // Les ennemis montent en stats avec le niveau du camp (fortification).
    get maxHp() { return Math.round(F.grow(this.base.hp, this.level, 1.12)); }
    get atk()   { return Math.round(F.grow(this.base.atk, this.level, 1.10)); }
    get arm()   { return Math.round(F.grow(this.base.arm, this.level, 1.10)) + (this.bonusArm || 0); }
    get agi()   { return Math.round(F.grow(this.base.agi, this.level, 1.04)); }
    get heal()  { return 0; }
    getPortrait() {
      if (!this.portrait) this.portrait = Game.Art.portrait(this.seed, 64, "enemy_" + this.family);
      return this.portrait;
    }
    toJSON() { return { id: this.id, seed: this.seed, typeKey: this.typeKey, level: this.level, base: this.base }; }
  }

  function makeEnemy(typeKey, level, seed) {
    seed = seed != null ? seed : RNG.seed();
    const rng = RNG.make(seed);
    const t = ENEMY_TYPES[typeKey];
    return new Enemy({
      id: "e" + (_enemyId++), seed, typeKey,
      name: t.name, family: t.family, aiKey: t.ai, isCaptain: t.captain,
      isBoss: t.boss, summonType: t.summon,
      level: level || 1,
      base: rollBase(rng, { hp: t.hp, atk: t.atk, arm: t.arm, agi: t.agi }),
    });
  }

  /* -------------------- Camps -------------------- */
  function makeCamp(def) {
    const enemies = def.roster.map(r => makeEnemy(r.type, def.level || 1, r.seed));
    return {
      id: def.id, name: def.name, pos: { x: def.pos.x, y: def.pos.y },
      family: def.family, level: def.level || 1,
      roster: def.roster, fortifyTimer: 0, cleared: false,
      baseReward: def.baseReward || { gold: 60, xp: 80 },
      permadeath: !!def.permadeath, isBoss: !!def.boss,
      enemies,
    };
  }

  /* =================================================================
     BÂTIMENTS
     ================================================================= */
  const BUILDING_DEFS = {
    townhall: { name: "Hôtel de Ville", produces: null },
    sawmill:  { name: "Scierie",  produces: "wood",  baseProd: 1.2, baseCap: 30 },
    mine:     { name: "Mine de Pierre", produces: "stone", baseProd: 0.9, baseCap: 28 },
  };

  class Building {
    constructor(data) {
      this.key = data.key;
      this.name = BUILDING_DEFS[data.key].name;
      this.pos = data.pos;
      this.level = data.level || 1;
      this.localStock = data.localStock || 0;
      this.def = BUILDING_DEFS[data.key];
      this.upgradeEndsAt = data.upgradeEndsAt || 0; // 0 = pas d'amélioration en cours
    }
    get produces() { return this.def.produces; }
    get prodPerSec() { return this.def.produces ? this.def.baseProd * (1 + (this.level - 1) * 0.5) : 0; }
    get capacity()   { return this.def.produces ? Math.round(this.def.baseCap * (1 + (this.level - 1) * 0.6)) : 0; }
    get upgradeCost() {
      const base = this.key === "sawmill" ? 60 : this.key === "mine" ? 75 : 120;
      return Math.round(base * Math.pow(1.6, this.level - 1));
    }
    get upgrading() { return this.upgradeEndsAt > Date.now(); }
    get upgradeRemaining() { return Math.max(0, this.upgradeEndsAt - Date.now()); }

    // Production passive (remplit le stock local jusqu'à capacité).
    produce(dt) {
      if (!this.produces || this.upgrading) return;
      this.localStock = Math.min(this.capacity, this.localStock + this.prodPerSec * dt);
    }
    // Le chariot vide le stock (renvoie la quantité réellement prise).
    take(maxAmount) {
      const n = Math.min(maxAmount, Math.floor(this.localStock));
      this.localStock -= n;
      return n;
    }
    toJSON() { return { key: this.key, pos: this.pos, level: this.level,
                        localStock: this.localStock, upgradeEndsAt: this.upgradeEndsAt }; }
  }

  /* =================================================================
     CHARIOTS LOGISTIQUES
     ================================================================= */
  class Chariot {
    constructor(data) {
      this.id = data.id;
      this.home = data.home;                 // {x,y} village
      this.buildingKey = data.buildingKey;   // bâtiment desservi
      this.pos = data.pos || { x: data.home.x, y: data.home.y };
      this.state = data.state || "to_source"; // to_source|loading|to_home|unloading
      this.cargoType = data.cargoType || null;
      this.cargo = data.cargo || 0;
      this.capacity = data.capacity || 12;
      this.speed = data.speed || 70;          // px/s monde
      this.timer = 0;
      this.angle = 0;
    }
    target(buildings) {
      const b = buildings[this.buildingKey];
      if (this.state === "to_source" || this.state === "loading") return b.pos;
      return this.home;
    }
    update(dt, buildings, onUnload) {
      const b = buildings[this.buildingKey];
      if (!b) return;
      if (this.state === "loading") {
        this.timer -= dt;
        if (this.timer <= 0) {
          const got = b.take(this.capacity);
          this.cargo = got; this.cargoType = b.produces;
          this.state = "to_home";
        }
        return;
      }
      if (this.state === "unloading") {
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.cargo > 0 && onUnload) onUnload(this.cargoType, this.cargo);
          this.cargo = 0; this.cargoType = null;
          this.state = "to_source";
        }
        return;
      }
      // déplacement
      const tg = this.target(buildings);
      const dx = tg.x - this.pos.x, dy = tg.y - this.pos.y;
      const dist = Math.hypot(dx, dy);
      this.angle = Math.atan2(dy, dx);
      const step = this.speed * dt;
      if (dist <= step) {
        this.pos.x = tg.x; this.pos.y = tg.y;
        if (this.state === "to_source") { this.state = "loading"; this.timer = 1.0; }
        else if (this.state === "to_home") { this.state = "unloading"; this.timer = 0.8; }
      } else {
        this.pos.x += (dx / dist) * step;
        this.pos.y += (dy / dist) * step;
      }
    }
    toJSON() { return { id: this.id, home: this.home, buildingKey: this.buildingKey, pos: this.pos,
                        state: this.state, cargoType: this.cargoType, cargo: this.cargo,
                        capacity: this.capacity, speed: this.speed }; }
  }

  /* =================================================================
     HELPERS DE COMBAT (facteurs dynamiques talents/buffs)
     ================================================================= */
  function atkOf(u) {
    let a = u.atk;
    if (u.talentKey === "berserk" && u.hp < u.maxHp * 0.5) a *= 1.25;
    if (u.enraged) a *= 2;          // boss enragé (futur)
    return Math.round(a);
  }
  function armOf(u) {
    let r = u.arm + (u.tempArm || 0);
    if (u.talentKey === "dernier_souffle" && u.hp < u.maxHp * 0.2) r *= 1.3;
    return Math.round(r);
  }

  /* =================================================================
     ART — portraits & helpers de dessin procéduraux
     ================================================================= */
  const SKINS = ["#caa07a", "#b98c63", "#9c6f4a", "#d8b894", "#7d5a3c", "#c2a487"];
  const HAIRS = ["#2a2018", "#46372a", "#71665a", "#1c1c1c", "#8a7a5c", "#5a2f22", "#d8d2c4"];

  const Art = {
    // Génère un portrait stylisé dans un canvas (visage reconnaissable, dark fantasy).
    portrait(seed, size, kind) {
      size = size || 64;
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const x = c.getContext("2d");
      const rng = mulberry32((seed >>> 0) ^ 0x9e3779b9);
      const enemy = kind && kind.indexOf("enemy") === 0;

      // fond
      const bg = x.createLinearGradient(0, 0, 0, size);
      bg.addColorStop(0, enemy ? "#241015" : "#1b2026");
      bg.addColorStop(1, "#0a0c0a");
      x.fillStyle = bg; x.fillRect(0, 0, size, size);

      const cx = size / 2, s = size / 64;
      let skin;
      if (enemy) {
        if (kind.indexOf("morts-vivants") >= 0) skin = RNG.pick(rng, ["#9aa39a", "#8a9488", "#aeb3a4", "#7c857a"]);
        else if (kind.indexOf("betes") >= 0)    skin = RNG.pick(rng, ["#7a5a3c", "#6b4f34", "#8a6a44", "#5d4630"]);
        else                                     skin = RNG.pick(rng, ["#7fa05a", "#6f7d4a", "#94a36a", "#5d6b3f"]);
      } else skin = RNG.pick(rng, SKINS);
      const hair = RNG.pick(rng, HAIRS);

      // épaules
      x.fillStyle = enemy ? "#2c2118" : "#3a342a";
      x.beginPath();
      x.moveTo(cx - 26 * s, size); x.quadraticCurveTo(cx - 24 * s, 44 * s, cx, 44 * s);
      x.quadraticCurveTo(cx + 24 * s, 44 * s, cx + 26 * s, size); x.closePath(); x.fill();

      // cou
      x.fillStyle = skin; x.fillRect(cx - 6 * s, 38 * s, 12 * s, 12 * s);

      // tête
      x.beginPath();
      x.ellipse(cx, 28 * s, 13 * s, 16 * s, 0, 0, Math.PI * 2);
      x.fillStyle = skin; x.fill();

      // oreilles (pointues si ennemi gobelin)
      x.fillStyle = skin;
      if (enemy) {
        x.beginPath(); x.moveTo(cx - 12 * s, 26 * s); x.lineTo(cx - 19 * s, 20 * s); x.lineTo(cx - 11 * s, 32 * s); x.fill();
        x.beginPath(); x.moveTo(cx + 12 * s, 26 * s); x.lineTo(cx + 19 * s, 20 * s); x.lineTo(cx + 11 * s, 32 * s); x.fill();
      }

      // cheveux / capuche
      x.fillStyle = hair;
      x.beginPath();
      x.ellipse(cx, 20 * s, 14 * s, 11 * s, 0, Math.PI, Math.PI * 2);
      x.fill();
      if (RNG.chance(rng, 0.5) && !enemy) { // mèches latérales
        x.fillRect(cx - 14 * s, 18 * s, 3 * s, 16 * s);
        x.fillRect(cx + 11 * s, 18 * s, 3 * s, 16 * s);
      }

      // yeux
      const eyeY = 28 * s, eyeDx = 5.5 * s;
      x.fillStyle = enemy ? "#ff3a2a" : "#15110d";
      x.beginPath(); x.arc(cx - eyeDx, eyeY, 1.7 * s, 0, 7); x.fill();
      x.beginPath(); x.arc(cx + eyeDx, eyeY, 1.7 * s, 0, 7); x.fill();
      if (enemy) { // lueur rouge
        x.shadowColor = "#ff2a1a"; x.shadowBlur = 6 * s;
        x.beginPath(); x.arc(cx - eyeDx, eyeY, 1.2 * s, 0, 7); x.fill();
        x.beginPath(); x.arc(cx + eyeDx, eyeY, 1.2 * s, 0, 7); x.fill();
        x.shadowBlur = 0;
      }

      // sourcils
      x.strokeStyle = hair; x.lineWidth = 1.6 * s;
      x.beginPath(); x.moveTo(cx - 8 * s, 24 * s); x.lineTo(cx - 3 * s, 25 * s);
      x.moveTo(cx + 8 * s, 24 * s); x.lineTo(cx + 3 * s, 25 * s); x.stroke();

      // nez + bouche
      x.strokeStyle = "rgba(0,0,0,.35)"; x.lineWidth = 1 * s;
      x.beginPath(); x.moveTo(cx, 29 * s); x.lineTo(cx - 1.5 * s, 33 * s); x.lineTo(cx + 1 * s, 33.5 * s); x.stroke();
      x.beginPath(); x.moveTo(cx - 4 * s, 36 * s); x.quadraticCurveTo(cx, 38 * s, cx + 4 * s, 36 * s); x.stroke();

      // barbe (certains héros) / défenses (ennemis)
      if (enemy) {
        x.fillStyle = "#e8e0cf";
        x.beginPath(); x.moveTo(cx - 3 * s, 37 * s); x.lineTo(cx - 4 * s, 41 * s); x.lineTo(cx - 1 * s, 37 * s); x.fill();
        x.beginPath(); x.moveTo(cx + 3 * s, 37 * s); x.lineTo(cx + 4 * s, 41 * s); x.lineTo(cx + 1 * s, 37 * s); x.fill();
      } else if (RNG.chance(rng, 0.45)) {
        x.fillStyle = hair;
        x.beginPath(); x.moveTo(cx - 9 * s, 33 * s); x.quadraticCurveTo(cx, 46 * s, cx + 9 * s, 33 * s);
        x.quadraticCurveTo(cx, 40 * s, cx - 9 * s, 33 * s); x.fill();
      }

      // vignette
      const vg = x.createRadialGradient(cx, 26 * s, 8 * s, cx, 30 * s, size * 0.7);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.55)");
      x.fillStyle = vg; x.fillRect(0, 0, size, size);
      // cadre
      x.strokeStyle = "#4a4d3e"; x.lineWidth = 2; x.strokeRect(1, 1, size - 2, size - 2);
      return c;
    },

    // Petite silhouette de personnage vue de dessus (pour la carte).
    drawWalker(ctx, x, y, scale, bodyColor, headColor, t) {
      const bob = Math.sin(t * 6) * 1.2 * scale;
      ctx.save();
      ctx.translate(x, y - bob);
      // ombre
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.beginPath(); ctx.ellipse(0, 2 * scale, 5 * scale, 2.2 * scale, 0, 0, 7); ctx.fill();
      // cape / corps
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.moveTo(-4 * scale, 1 * scale);
      ctx.quadraticCurveTo(0, -11 * scale, 4 * scale, 1 * scale);
      ctx.closePath(); ctx.fill();
      // tête
      ctx.fillStyle = headColor;
      ctx.beginPath(); ctx.arc(0, -9 * scale, 2.6 * scale, 0, 7); ctx.fill();
      ctx.restore();
    },
  };
  Game.Art = Art;

  /* -------------------- Export -------------------- */
  Game.Entities = {
    F, CLASSES, TALENTS, ENEMY_TYPES, BUILDING_DEFS,
    Hero, Enemy, Building, Chariot,
    makeHero, makeEnemy, makeCamp, genName,
    atkOf, armOf,
  };

})(window.Game = window.Game || {});
