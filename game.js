/* =================================================================
   game.js — Orchestrateur : boucle, état, économie, UI, état-machine
   ================================================================= */
(function (Game) {
  "use strict";

  /* ================= CONFIG ================= */
  Game.config = {
    world: { w: 2600, h: 3400 },
    poi: {
      townhall: { x: 1300, y: 1700 },
      sawmill:  { x: 760,  y: 1250 },
      mine:     { x: 1880, y: 1280 },
    },
  };

  const CAMP_DEFS = {
    chariot_casse: {
      id: "chariot_casse", name: "Chariot Cassé", pos: { x: 1320, y: 780 },
      family: "gobelins", level: 1,
      roster: [{ type: "soldat_korcha" }, { type: "soldat_korcha" }, { type: "capitaine_korcha" }],
      baseReward: { gold: 80, xp: 120 },
    },
  };

  const DIFFS = {
    easy:     { key: "easy",     label: "Facile",    startGold: 220, prodMult: 1.5, fortifyMult: 0.5, woundSec: 20,  lossMult: 0.0 },
    normal:   { key: "normal",   label: "Normal",    startGold: 140, prodMult: 1.0, fortifyMult: 1.0, woundSec: 45,  lossMult: 0.10 },
    hard:     { key: "hard",     label: "Difficile", startGold: 90,  prodMult: 0.7, fortifyMult: 1.6, woundSec: 90,  lossMult: 0.20 },
    hardcore: { key: "hardcore", label: "Hardcore",  startGold: 70,  prodMult: 0.6, fortifyMult: 2.0, woundSec: 180, lossMult: 0.40, permadeath: true },
  };
  Game.DIFFS = DIFFS;

  const MISSION_SPEED = 135;   // px/s monde
  const FORTIFY_SEC = 200;     // intervalle de fortification d'un camp
  const RESPAWN_SEC = 75;      // ré-apparition d'un camp vaincu
  const RECRUIT_COST = 50;     // or par recrue

  /* ================= HELPERS ================= */
  Game.fmt = (n) => {
    n = Math.floor(n);
    if (n >= 1e6) return (n / 1e6).toFixed(2) + " Mil";
    if (n >= 1e3) return (n / 1e3).toFixed(2) + " k";
    return "" + n;
  };
  Game.fmtTime = (ms) => {
    let s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    if (h > 0) return h + "h " + String(m).padStart(2, "0") + "m";
    if (m > 0) return m + "m " + String(s).padStart(2, "0") + "s";
    return s + "s";
  };
  Game.heroById = (id) => Game.state && Game.state.heroes.find(h => h.id === id);
  const campById = (id) => Game.state.camps.find(c => c.id === id);
  const E = () => Game.Entities;

  /* ================= CRÉATION D'ÉTAT ================= */
  function makeBuildings() {
    const P = Game.config.poi, B = E().Building;
    return {
      townhall: new B({ key: "townhall", pos: { ...P.townhall }, level: 1 }),
      sawmill:  new B({ key: "sawmill",  pos: { ...P.sawmill },  level: 1 }),
      mine:     new B({ key: "mine",     pos: { ...P.mine },     level: 1 }),
    };
  }
  function makeCampFromDef(def, level, cleared) {
    const c = E().makeCamp({ ...def, level: level || def.level });
    if (cleared) c.cleared = true;
    return c;
  }
  function rebuildEnemies(camp) {
    const def = CAMP_DEFS[camp.id];
    camp.enemies = def.roster.map(r => E().makeEnemy(r.type, camp.level));
  }

  function freshState(diffKey) {
    const d = DIFFS[diffKey] || DIFFS.normal;
    const P = Game.config.poi;
    const buildings = makeBuildings();
    const chariot = new (E().Chariot)({
      id: "c1", home: { ...P.townhall }, buildingKey: "sawmill",
      pos: { ...P.townhall }, capacity: 12, speed: 90,
    });
    const camps = Object.values(CAMP_DEFS).map(def => makeCampFromDef(def));
    // 1 héros de départ + la taverne pour en recruter d'autres
    const starter = E().makeHero({ classKey: "guerrier",
      pos: { x: P.townhall.x + 40, y: P.townhall.y + 36 } });

    return {
      difficulty: diffKey, diff: d, worldSeed: E().__seed || (Game.RNG.seed()),
      resources: { gold: d.startGold, wood: 0, stone: 0 },
      camera: { x: P.townhall.x, y: P.townhall.y },
      buildings, chariots: [chariot], heroes: [starter], camps,
      selection: [], mission: null, victoryChest: null,
      paused: false, time: 0, lastSaved: Date.now(),
    };
  }

  /* ================= CHARGEMENT ================= */
  function applyLoad(data) {
    const d = DIFFS[data.difficulty] || DIFFS.normal;
    const B = E().Building, Ch = E().Chariot, H = E().Hero;
    const buildings = {};
    for (const k in data.buildings) {
      buildings[k] = new B(data.buildings[k]);
      if (buildings[k].upgradeEndsAt) buildings[k]._upgradeDur =
        Math.max(1, (buildings[k].upgradeEndsAt - data.savedAt) / 1000);
    }
    const chariots = data.chariots.map(cd => new Ch(cd));
    const heroes = data.heroes.map(hd => {
      const h = new H(hd);
      if (h.state === "mission" || h.state === "fighting") h.state = "idle"; // missions annulées au reload
      return h;
    });
    const camps = Object.values(CAMP_DEFS).map(def => {
      const sv = (data.camps || []).find(c => c.id === def.id) || {};
      const c = makeCampFromDef(def, sv.level || def.level, sv.cleared);
      c.fortifyTimer = sv.fortifyTimer || 0; c.respawnTimer = sv.respawnTimer || 0;
      return c;
    });

    Game.state = {
      difficulty: data.difficulty, diff: d, worldSeed: data.worldSeed || Game.RNG.seed(),
      resources: { gold: data.resources.gold || 0, wood: data.resources.wood || 0, stone: data.resources.stone || 0 },
      camera: { x: data.camera.x, y: data.camera.y },
      buildings, chariots, heroes, camps,
      selection: [], mission: null, victoryChest: data.victoryChest || null,
      paused: false, time: 0, lastSaved: data.savedAt,
    };

    // gains hors-ligne
    const og = Game.Save.offlineGains(data);
    if (og.wood || og.stone) {
      Game.state.resources.wood += og.wood;
      Game.state.resources.stone += og.stone;
      Game._offlineMsg = "Retour ! Hors-ligne (" + Game.fmtTime(og.seconds * 1000) + ") : +" +
        og.wood + " bois, +" + og.stone + " pierre.";
    }
  }

  /* ================= SÉLECTION ================= */
  Game.toggleSelect = (id) => {
    const h = Game.heroById(id);
    if (!h || h.state !== "idle") return;
    const i = Game.state.selection.indexOf(id);
    if (i >= 0) Game.state.selection.splice(i, 1);
    else Game.state.selection.push(id);
  };
  Game.clearSelection = () => { Game.state.selection.length = 0; };

  /* ================= MISSIONS / COMBAT ================= */
  Game.sendSelectedTo = (camp) => {
    if (camp.cleared) { Game.UI.toast("Ce camp est déjà vaincu."); return; }
    if (Game.Combat.active || (Game.state.mission && Game.state.mission.state === "traveling")) {
      Game.UI.toast("Une expédition est déjà en cours."); return;
    }
    const ids = Game.state.selection.filter(id => { const h = Game.heroById(id); return h && h.state === "idle"; });
    if (ids.length === 0) { Game.UI.toast("Sélectionne au moins un héros (clique dessus sur la carte)."); return; }
    const v = Game.state.buildings.townhall.pos;
    const dist = Math.hypot(camp.pos.x - v.x, camp.pos.y - v.y);
    const total = dist / MISSION_SPEED;
    Game.state.mission = {
      heroIds: ids.slice(), campId: camp.id,
      pos: { x: v.x, y: v.y }, target: { x: camp.pos.x, y: camp.pos.y },
      total, remaining: total, progress: 0, state: "traveling",
    };
    ids.forEach(id => { Game.heroById(id).state = "mission"; });
    Game.clearSelection();
    Game.UI.closeCampMenu();
    Game.UI.toast(ids.length + " héros en route vers « " + camp.name + " »");
  };

  function arriveMission(m) {
    const camp = campById(m.campId);
    Game.state.mission = null;
    if (!camp) return;
    Game.Combat.start(m.heroIds, camp);
  }

  Game.grantVictory = (camp, heroes) => {
    camp.cleared = true; camp.respawnTimer = 0;
    const lvl = camp.level;
    let gold = Math.round(camp.baseReward.gold * lvl);
    const xp = Math.round(camp.baseReward.xp * lvl);
    if (heroes.some(h => h.talentKey === "cupide")) gold = Math.round(gold * 1.15);
    Game.state.victoryChest = { place: camp.name, gold, xp, heroIds: heroes.map(h => h.id) };
    returnHeroes(heroes);
    Game.UI.showChest(camp.name);
    Game.UI.toast("Victoire à « " + camp.name + " » ! Ouvre le coffre pour récupérer le butin.");
    Game.Save.save();
  };

  Game.grantDefeat = (camp, heroes) => {
    returnHeroes(heroes);
    const loss = Math.round(Game.state.resources.gold * Game.state.diff.lossMult);
    Game.state.resources.gold = Math.max(0, Game.state.resources.gold - loss);
    Game.UI.toast("Défaite à « " + camp.name + " »" + (loss > 0 ? " — " + loss + " or perdu." : "."));
    Game.Save.save();
  };

  function returnHeroes(heroes) {
    const v = Game.state.buildings.townhall.pos;
    for (const h of heroes) {
      if (h.hp <= 0) {
        h.state = "wounded";
        h.woundedUntil = Date.now() + Game.state.diff.woundSec * 1000;
      } else {
        h.state = "idle";
        h.hp = h.maxHp;
      }
      h.pos = { x: v.x + (Math.random() - 0.5) * 80, y: v.y + (Math.random() - 0.5) * 70 };
      h.wander = null;
    }
  }

  Game.openVictoryChest = () => {
    const vc = Game.state.victoryChest;
    if (!vc) return;
    Game.state.resources.gold += vc.gold;
    const results = [];
    for (const id of vc.heroIds) {
      const h = Game.heroById(id);
      if (!h) continue;
      results.push({ hero: h, res: h.addXp(vc.xp) });
    }
    Game.UI.renderVictory(vc, results);
    Game.state.victoryChest = null;
    Game.UI.hideChest();
    Game.UI.refreshHUD(true);
    Game.Save.save();
  };

  /* ================= BÂTIMENTS ================= */
  Game.upgradeBuilding = (b) => {
    if (b.upgrading) { Game.UI.toast("Amélioration déjà en cours."); return; }
    const cost = b.upgradeCost;
    if (Game.state.resources.gold < cost) { Game.UI.toast("Or insuffisant (" + cost + " requis)."); return; }
    Game.state.resources.gold -= cost;
    const dur = Math.min(60, 10 + b.level * 6);
    b._upgradeDur = dur;
    b.upgradeEndsAt = Date.now() + dur * 1000;
    Game.UI.toast(b.name + " : amélioration lancée (" + Game.fmtTime(dur * 1000) + ").");
    Game.UI.refreshHUD(true);
    Game.Save.save();
  };

  function bestProducer() {
    const b = Game.state.buildings;
    const cand = ["sawmill", "mine"].map(k => b[k]).filter(x => x && !x.upgrading);
    if (cand.length === 0) return "sawmill";
    cand.sort((a, c) => c.localStock - a.localStock);
    return cand[0].key;
  }

  /* ================= BOUCLE PRINCIPALE ================= */
  let _last = 0, _hudAcc = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    const now = ts || performance.now();
    let dt = (now - _last) / 1000;
    _last = now;
    if (!Game.running || !Game.state) return;
    if (dt > 0.1) dt = 0.1;                 // anti-saut (onglet inactif)
    update(dt);
    Game.World.render();
    _hudAcc += dt;
    if (_hudAcc >= 0.15) { Game.UI.refreshHUD(); _hudAcc = 0; }
    Game._fpsAcc = (Game._fpsAcc || 0) * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;
    const fps = document.getElementById("fps");
    if (fps) fps.textContent = Math.round(Game._fpsAcc) + " fps";
  }

  function update(dt) {
    const st = Game.state;
    st.time += dt;

    // production + fin d'amélioration
    const now = Date.now();
    for (const k in st.buildings) {
      const b = st.buildings[k];
      if (b.upgradeEndsAt && now >= b.upgradeEndsAt) {
        b.level++; b.upgradeEndsAt = 0;
        Game.UI.toast(b.name + " atteint le niveau " + b.level + " !");
      }
      b.produce(dt * st.diff.prodMult);
    }

    // chariots
    for (const ch of st.chariots) {
      if (ch.state === "to_source" && Math.hypot(ch.pos.x - ch.home.x, ch.pos.y - ch.home.y) < 3) {
        ch.buildingKey = bestProducer();
      }
      ch.update(dt, st.buildings, (type, amount) => { if (type) st.resources[type] += amount; });
    }

    // mission
    const m = st.mission;
    if (m && m.state === "traveling") {
      const dx = m.target.x - m.pos.x, dy = m.target.y - m.pos.y, d = Math.hypot(dx, dy);
      const step = MISSION_SPEED * dt;
      if (d <= step) { m.pos.x = m.target.x; m.pos.y = m.target.y; m.state = "arrived"; arriveMission(m); }
      else { m.pos.x += dx / d * step; m.pos.y += dy / d * step; m.remaining = d / MISSION_SPEED; m.progress = 1 - m.remaining / m.total; }
    }

    // combat
    if (Game.Combat.active) {
      Game.Combat.update(dt);
      Game.UI.updateCombatIndicator();
    } else {
      Game.UI.updateCombatIndicator();
    }

    // récupération des blessés
    for (const h of st.heroes) {
      if (h.state === "wounded" && now >= h.woundedUntil) { h.state = "idle"; h.hp = h.maxHp; }
    }

    // camps : fortification / ré-apparition
    for (const c of st.camps) {
      if (c.cleared) {
        c.respawnTimer = (c.respawnTimer || 0) + dt;
        if (c.respawnTimer >= RESPAWN_SEC) { rebuildEnemies(c); c.cleared = false; c.respawnTimer = 0; }
      } else if (!Game.Combat.active || Game.Combat.camp !== c) {
        c.fortifyTimer += dt * st.diff.fortifyMult;
        if (c.fortifyTimer >= FORTIFY_SEC) {
          c.fortifyTimer = 0; c.level++; rebuildEnemies(c);
          if (Game.World.isOnScreen(c.pos.x, c.pos.y)) Game.UI.toast("« " + c.name + " » se fortifie (niv. " + c.level + ").");
        }
      }
    }

    Game.World.update(dt);
  }

  /* ================= UI ================= */
  const $ = (id) => document.getElementById(id);

  const UI = {
    _toastTimer: null,
    _openBuilding: null,

    refreshHUD(force) {
      const st = Game.state; if (!st) return;
      $("resGold").textContent = Game.fmt(st.resources.gold);
      $("resWood").textContent = Game.fmt(st.resources.wood);
      $("resStone").textContent = Game.fmt(st.resources.stone);
      $("diffLabel").textContent = st.diff.label;
      if (this._openBuilding) this.renderBuildingPanel(this._openBuilding);
    },

    toast(msg) {
      const t = $("toast");
      t.textContent = msg; t.classList.remove("hidden");
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
    },

    /* ---- panneau bâtiment ---- */
    openBuildingPanel(b) { this._openBuilding = b; this.renderBuildingPanel(b); $("buildingPanel").classList.remove("hidden"); },
    closeBuildingPanel() { this._openBuilding = null; $("buildingPanel").classList.add("hidden"); },
    renderBuildingPanel(b) {
      $("bpName").textContent = b.name;
      $("bpLevel").textContent = "Niv. " + b.level;
      const body = $("bpBody"), acts = $("bpActions");
      if (b.produces) {
        const ratio = b.capacity ? b.localStock / b.capacity : 0;
        body.innerHTML =
          '<div>Production : <b style="color:var(--green)">+' + (b.prodPerSec * Game.state.diff.prodMult).toFixed(1) +
            " " + (b.produces === "wood" ? "bois" : "pierre") + "/s</b></div>" +
          '<div style="margin-top:4px">Capacité du chariot vidée au village.</div>' +
          '<div class="stockbar"><div>Stock local : ' + Math.floor(b.localStock) + " / " + b.capacity + "</div>" +
            '<div class="bar bar-stock"><i style="transform:scaleX(' + Math.min(1, ratio) + ')"></i></div></div>';
        acts.innerHTML = b.upgrading
          ? '<div class="warn">Amélioration… ' + Game.fmtTime(b.upgradeRemaining) + "</div>"
          : '<button class="btn btn-primary btn-small" id="bpUpgrade">Améliorer (' + b.upgradeCost + " ◆)</button>";
        if (!b.upgrading) $("bpUpgrade").onclick = () => Game.upgradeBuilding(b);
      } else {
        const st = Game.state;
        const ready = st.heroes.filter(h => h.state === "idle").length;
        const wounded = st.heroes.filter(h => h.state === "wounded").length;
        body.innerHTML =
          "<div>Cœur du royaume. Centre du monde.</div>" +
          '<div style="margin-top:6px">Héros : <b>' + st.heroes.length + "</b> — disponibles : " +
            '<b style="color:var(--green)">' + ready + "</b>" + (wounded ? ", blessés : <b style='color:var(--red)'>" + wounded + "</b>" : "") + "</div>";
        acts.innerHTML =
          '<button class="btn btn-small" id="bpRecruit">Taverne</button>' +
          '<button class="btn btn-small" id="bpHeroes">Héros</button>';
        $("bpRecruit").onclick = () => this.openRecruit();
        $("bpHeroes").onclick = () => this.openHeroes();
      }
    },

    /* ---- menu camp ---- */
    openCampMenu(camp) {
      $("cmTitle").textContent = camp.name;
      const alive = camp.enemies.filter(e => e.hp > 0);
      let html = '<div style="margin-bottom:6px;color:var(--muted)">Famille : ' + camp.family + " · Niveau " + camp.level + "</div>";
      if (camp.cleared) {
        html += '<div class="warn">Camp vaincu. Réapparition dans ' + Game.fmtTime((RESPAWN_SEC - (camp.respawnTimer || 0)) * 1000) + ".</div>";
      } else {
        for (const e of alive) {
          html += '<div class="enemy-row"><span>' + e.name + (e.isCaptain ? " ⭐" : "") + "</span>" +
                  '<span style="margin-left:auto;color:#ff9a8a">✕' + e.atk + "</span>" +
                  '<span style="color:#b9bcc4">⛊' + e.arm + "</span>" +
                  '<span style="color:#ff6f6f">❤' + e.maxHp + "</span></div>";
        }
        const reward = camp.baseReward.gold * camp.level;
        html += '<div style="margin-top:8px">Récompense : <b style="color:var(--gold-hi)">' + reward + " ◆</b> + XP</div>";
        html += '<div style="margin-top:6px;color:var(--green)">✔ Aucun risque de mort définitive sur cette mission.</div>';
      }
      $("cmBody").innerHTML = html;
      const sendBtn = $("cmSend");
      sendBtn.disabled = camp.cleared;
      sendBtn.onclick = () => Game.sendSelectedTo(camp);
      $("campMenu").classList.remove("hidden");
    },
    closeCampMenu() { $("campMenu").classList.add("hidden"); },

    /* ---- coffre de victoire ---- */
    showChest(place) { $("vcLabel").textContent = place; $("victoryChest").classList.remove("hidden"); },
    hideChest() { $("victoryChest").classList.add("hidden"); },

    /* ---- indicateur de combat hors-écran ---- */
    updateCombatIndicator() {
      const ind = $("combatIndicator");
      if (Game.Combat.active && Game.Combat.camp && !Game.World.isOnScreen(Game.Combat.pos.x, Game.Combat.pos.y, 40)) {
        ind.classList.remove("hidden");
      } else {
        ind.classList.add("hidden");
      }
    },

    /* ---- modales ---- */
    showModal(id) { $(id).classList.remove("hidden"); },
    hideModal(id) { $(id).classList.add("hidden"); },

    openRecruit() {
      Game._recruits = [E().makeHero(), E().makeHero(), E().makeHero()];
      this.renderRecruit();
      this.showModal("recruitModal");
    },
    renderRecruit() {
      const body = $("recruitBody");
      body.innerHTML = '<div style="margin-bottom:10px;color:var(--muted)">Or : <b style="color:var(--gold-hi)">' +
        Game.fmt(Game.state.resources.gold) + "</b> · Coût par recrue : " + RECRUIT_COST + " ◆</div>";
      const grid = document.createElement("div"); grid.className = "recruit-grid";
      Game._recruits.forEach((h, i) => {
        const card = buildHeroCard(h, { action: "recruit", index: i, cost: RECRUIT_COST });
        grid.appendChild(card);
      });
      body.appendChild(grid);
    },
    recruit(i) {
      const h = Game._recruits[i];
      if (!h) return;
      if (Game.state.resources.gold < RECRUIT_COST) { this.toast("Or insuffisant pour recruter."); return; }
      Game.state.resources.gold -= RECRUIT_COST;
      const v = Game.state.buildings.townhall.pos;
      h.pos = { x: v.x + (Math.random() - 0.5) * 90, y: v.y + (Math.random() - 0.5) * 80 };
      h.state = "idle";
      Game.state.heroes.push(h);
      Game._recruits[i] = E().makeHero();   // remplace l'emplacement
      this.toast("« " + h.name + " » (" + h.className + ") rejoint le royaume !");
      this.renderRecruit(); this.refreshHUD(true); Game.Save.save();
    },

    openHeroes() {
      const body = $("heroesBody");
      body.innerHTML = "";
      if (Game.state.heroes.length === 0) { body.innerHTML = '<div style="color:var(--muted)">Aucun héros. Va à la Taverne.</div>'; }
      for (const h of Game.state.heroes) body.appendChild(buildHeroCard(h, { action: "info" }));
      this.showModal("heroesModal");
    },

    renderVictory(vc, results) {
      const body = $("victoryBody");
      let html = '<div class="vm-rewards"><span class="rw-gold">+' + vc.gold + " ◆ Or</span>" +
                 '<span class="rw-xp">+' + vc.xp + " XP / héros</span></div>";
      body.innerHTML = html;
      for (const r of results) {
        const row = document.createElement("div"); row.className = "vm-hero";
        const pic = Game.Art.portrait(r.hero.seed, 42, r.hero.classKey);
        row.appendChild(pic);
        const info = document.createElement("div"); info.style.flex = "1";
        let txt = '<div style="font-family:var(--title-font);color:var(--cream)">' + r.hero.name +
                  ' <span style="color:var(--muted);font-size:11px">Niv.' + r.hero.level + "</span></div>";
        txt += '<div class="vm-up">+' + r.res.gained + " XP" + (r.res.levelsUp ? " · ▲ Niveau +" + r.res.levelsUp + " !" : "") + "</div>";
        for (const sk of r.res.newSkills) txt += '<div class="vm-skill">✦ Nouvelle compétence : ' + sk.name + "</div>";
        // barre XP
        const need = E().F.xpToNext(r.hero.level);
        txt += '<div class="bar bar-xp" style="margin-top:4px"><i style="transform:scaleX(' + Math.min(1, r.hero.xp / need) + ')"></i></div>';
        info.innerHTML = txt;
        row.appendChild(info);
        body.appendChild(row);
      }
      this.showModal("victoryModal");
    },
  };
  Game.UI = UI;

  /* ---- carte de héros réutilisable (DOM) ---- */
  function buildHeroCard(h, opts) {
    opts = opts || {};
    const card = document.createElement("div"); card.className = "hero-card";
    const pic = Game.Art.portrait(h.seed, 56, h.classKey);
    card.appendChild(pic);
    const info = document.createElement("div"); info.className = "hc-info";
    const need = E().F.xpToNext(h.level);
    let woundTxt = "";
    if (h.state === "wounded") woundTxt = ' <span style="color:var(--red)">(blessé ' + Game.fmtTime(h.woundedUntil - Date.now()) + ")</span>";
    info.innerHTML =
      '<div class="hc-name"><span>' + h.name + woundTxt + '</span><span class="hc-lvl">Niv.' + h.level + "</span></div>" +
      '<div class="hc-class">' + h.className + "</div>" +
      '<div class="hc-stats"><span class="st-hp">❤' + h.maxHp + '</span><span class="st-atk">✕' + h.atk +
        '</span><span class="st-arm">⛊' + h.arm + '</span><span class="st-agi">⚡' + h.agi + "</span></div>" +
      '<div class="bar bar-xp"><i style="transform:scaleX(' + Math.min(1, h.xp / need) + ')"></i>' +
        '<span class="bar-label">' + h.xp + " / " + need + " XP</span></div>" +
      '<div class="hc-talent">✦ ' + (h.talent ? h.talent.name + " — " + h.talent.desc : "") + "</div>";
    card.appendChild(info);
    if (opts.action === "recruit") {
      const wrap = document.createElement("div"); wrap.className = "hc-actions";
      const btn = document.createElement("button");
      btn.className = "btn btn-primary btn-small";
      btn.textContent = "Recruter (" + opts.cost + " ◆)";
      btn.disabled = Game.state.resources.gold < opts.cost;
      btn.onclick = () => Game.UI.recruit(opts.index);
      wrap.appendChild(btn); info.appendChild(wrap);
    }
    return card;
  }

  /* ================= DÉMARRAGE DE PARTIE ================= */
  function beginPlay() {
    Game.World.generate(Game.state.worldSeed);
    Game.World.centerOn(Game.config.poi.townhall.x, Game.config.poi.townhall.y);
    Game.running = true;
    Game.UI.hideModal("startScreen");
    Game.UI.refreshHUD(true);
    if (Game.state.victoryChest) Game.UI.showChest(Game.state.victoryChest.place);
    Game.Save.autosaveStart(10000);
    if (Game._offlineMsg) { Game.UI.toast(Game._offlineMsg); Game._offlineMsg = null; }
  }

  Game.newGame = (diffKey) => {
    Game.state = freshState(diffKey);
    Game.Save.save();
    beginPlay();
    Game.UI.toast("Bienvenue ! Clique sur ton héros (cercle bleu), puis sur le camp pour l'envoyer au combat.");
  };
  Game.continueGame = () => {
    const data = Game.Save.load();
    if (!data) { Game.newGame("normal"); return; }
    applyLoad(data);
    beginPlay();
  };

  /* ================= INIT (DOM prêt) ================= */
  function init() {
    Game.World.init();

    // écran de démarrage
    document.querySelectorAll(".diff-card").forEach(card => {
      card.addEventListener("click", () => {
        const diff = card.getAttribute("data-diff");
        if (Game.Save.has() && !window.confirm("Une sauvegarde existe déjà. Démarrer une NOUVELLE partie en " +
            DIFFS[diff].label + " l'écrasera définitivement. Continuer ?")) return;
        Game.Save.clear();
        Game.newGame(diff);
      });
    });
    if (Game.Save.has()) {
      const cont = $("continueBtn");
      cont.classList.remove("hidden");
      cont.addEventListener("click", () => Game.continueGame());
    }

    // toolbar
    document.querySelectorAll(".tool").forEach(btn => {
      btn.addEventListener("click", () => {
        switch (btn.getAttribute("data-action")) {
          case "recruit": Game.UI.openRecruit(); break;
          case "heroes": Game.UI.openHeroes(); break;
          case "recenter": Game.World.centerOn(Game.config.poi.townhall.x, Game.config.poi.townhall.y); break;
          case "save": Game.Save.save() ? Game.UI.toast("Partie sauvegardée.") : Game.UI.toast("Échec de la sauvegarde."); break;
        }
      });
    });

    // coffre de victoire
    $("victoryChest").addEventListener("click", () => Game.openVictoryChest());

    // fermetures (panneau / menus / modales)
    $("bpClose").addEventListener("click", () => Game.UI.closeBuildingPanel());
    $("cmClose").addEventListener("click", () => Game.UI.closeCampMenu());
    document.querySelectorAll("[data-close]").forEach(b =>
      b.addEventListener("click", () => Game.UI.hideModal(b.getAttribute("data-close"))));
    document.querySelectorAll(".modal-overlay").forEach(ov => {
      if (ov.id === "startScreen") return;
      ov.addEventListener("pointerdown", (e) => { if (e.target === ov) ov.classList.add("hidden"); });
    });

    // boucle (tourne en permanence ; ne fait rien tant que !running)
    requestAnimationFrame(loop);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})(window.Game = window.Game || {});
