/* =================================================================
   combat.js — Combat automatique (face-à-face sans grille)
   Ordre d'action par Agilité (ATB), IA, percussion, textes flottants.
   ================================================================= */
(function (Game) {
  "use strict";

  const THRESH = 100;       // seuil de jauge d'action
  const GAUGE_K = 10;       // vitesse de remplissage (× agilité)
  const ANIM_OUT = 0.16, ANIM_IN = 0.16, ANIM_HOLD = 0.06;

  const Combat = {
    active: false,
    camp: null,
    pos: { x: 0, y: 0 },
    heroes: [], enemies: [], units: [],
    floaters: [],
    state: "fighting",      // fighting | won | lost
    endTimer: 0,
    anim: null,
    captainDead: false,
    banner: "",

    /* ---------------- démarrage ---------------- */
    start(heroIds, camp) {
      this.camp = camp;
      this.pos = { x: camp.pos.x, y: camp.pos.y };
      this.floaters = [];
      this.state = "fighting";
      this.endTimer = 0;
      this.anim = null;
      this.captainDead = false;
      this.banner = "";

      // héros participants
      this.heroes = heroIds.map(id => Game.heroById(id)).filter(Boolean);
      this.heroes.forEach((h, i) => this._initUnit(h, "hero", i));
      // ennemis du camp (PV remis à neuf par _initUnit)
      this.enemies = camp.enemies;
      this.enemies.forEach((e, i) => this._initUnit(e, "enemy", i));

      this.units = this.heroes.concat(this.enemies);
      this.active = true;
      Game.UI.toast("⚔ Combat à « " + camp.name + " »");
    },

    _initUnit(u, side, idx) {
      u.side = side;
      u.slotIndex = idx;
      u.alive = true;
      u.fled = false;
      u.hp = u.maxHp;
      u.gauge = Math.random() * 30;     // léger décalage initial
      u.tempArm = 0;
      u.buffTurns = 0;
      u.guardCd = 0;
      u.flash = 0;
      u.offX = 0; u.offY = 0;
      u.enraged = false;
      if (side === "hero") u.state = "fighting";
    },

    livingHeroes() { return this.heroes.filter(u => u.alive); },
    livingEnemies() { return this.enemies.filter(u => u.alive); },

    /* ---------------- boucle ---------------- */
    update(dt) {
      if (!this.active) return;
      this._updateFloaters(dt);
      for (const u of this.units) if (u.flash > 0) u.flash = Math.max(0, u.flash - dt * 4);

      if (this.state !== "fighting") {
        this.endTimer -= dt;
        if (this.endTimer <= 0) this._finalize();
        return;
      }

      if (this.anim) { this._updateAnim(dt); return; }

      // personne en action : on remplit les jauges, le plus rapide agit
      let actor = null, best = THRESH;
      for (const u of this.units) {
        if (!u.alive) continue;
        u.gauge += u.agi * GAUGE_K * dt;
        if (u.gauge >= best) { best = u.gauge; actor = u; }
      }
      if (actor) this._beginTurn(actor);
    },

    /* ---------------- décision (IA) ---------------- */
    _beginTurn(actor) {
      actor.gauge -= THRESH;
      // expiration des buffs au début du tour de l'unité
      if (actor.buffTurns > 0) { actor.buffTurns--; if (actor.buffTurns === 0) actor.tempArm = 0; }
      if (actor.guardCd > 0) actor.guardCd--;

      const action = this._decide(actor);
      if (!action) { return; } // rien à faire (pas de cible) → tour perdu
      this.anim = {
        actor, target: action.target, type: action.type,
        phase: "out", t: 0, impactDone: false,
      };
    },

    _decide(actor) {
      if (actor.side === "hero") return this._decideHero(actor);
      return this._decideEnemy(actor);
    },

    _decideHero(h) {
      const enemies = this.livingEnemies();
      const allies = this.livingHeroes();
      if (enemies.length === 0) return null;
      const ai = h.cls.ai;

      // Soigneur : soigne l'allié le plus bas si nécessaire
      if (ai === "healer") {
        const hurt = allies.filter(a => a.hp < a.maxHp * 0.6)
                           .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
        if (hurt) return { type: "heal", target: hurt };
        return { type: "attack", target: enemies[0] };
      }
      // Guerrier : compétence défensive sous 35% PV
      if (ai === "warrior") {
        if (h.hp < h.maxHp * 0.35 && h.guardCd <= 0 && h.unlockedSkills.includes("garde")) {
          return { type: "guard", target: h };
        }
        return { type: "attack", target: enemies[0] }; // le plus proche (haut de colonne)
      }
      // Assassin : cible le PV le plus bas (exécution)
      if (ai === "assassin") {
        const t = enemies.slice().sort((a, b) => a.hp - b.hp)[0];
        return { type: "attack", target: t };
      }
      return { type: "attack", target: enemies[0] };
    },

    _decideEnemy(e) {
      const heroes = this.livingHeroes();
      if (heroes.length === 0) return null;
      // Gobelin lâche : fuit si le capitaine est mort
      if (e.aiKey === "sbire" && this.captainDead && Math.random() < 0.4) {
        e.alive = false; e.fled = true;
        this._floater(e, "Fuite !", "#ffd24a", 12);
        this._checkEnd();
        return null;
      }
      if (e.aiKey === "capitaine") {
        // attaque le héros le plus faible (agressif)
        const t = heroes.slice().sort((a, b) => a.hp - b.hp)[0];
        return { type: "attack", target: t };
      }
      // sbire : le plus proche (haut de colonne)
      return { type: "attack", target: heroes[0] };
    },

    /* ---------------- animation de percussion ---------------- */
    _updateAnim(dt) {
      const a = this.anim, actor = a.actor;
      const from = this._slot(actor);
      let to;
      if (a.type === "guard") { to = { x: from.x, y: from.y - 10 }; }
      else { to = this._slot(a.target); }

      if (a.phase === "out") {
        a.t += dt / ANIM_OUT;
        const k = this._ease(Math.min(1, a.t));
        actor.offX = (to.x - from.x) * k * (a.type === "guard" ? 1 : 0.78);
        actor.offY = (to.y - from.y) * k * (a.type === "guard" ? 1 : 0.78);
        if (a.t >= 1 && !a.impactDone) { this._impact(a); a.impactDone = true; a.phase = "hold"; a.t = 0; }
      } else if (a.phase === "hold") {
        a.t += dt / ANIM_HOLD;
        if (a.t >= 1) { a.phase = "in"; a.t = 0; }
      } else { // in
        a.t += dt / ANIM_IN;
        const k = this._ease(Math.min(1, a.t));
        actor.offX = (to.x - from.x) * (1 - k) * (a.type === "guard" ? 1 : 0.78);
        actor.offY = (to.y - from.y) * (1 - k) * (a.type === "guard" ? 1 : 0.78);
        if (a.t >= 1) { actor.offX = 0; actor.offY = 0; this.anim = null; this._checkEnd(); }
      }
    },
    _ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },

    _impact(a) {
      const actor = a.actor, target = a.target;
      if (a.type === "guard") {
        actor.tempArm = 4; actor.buffTurns = 2; actor.guardCd = 4;
        this._floater(actor, "Garde +4", "#9ad0ff", 11);
        actor.flash = 1;
        return;
      }
      if (a.type === "heal") {
        const amount = actor.heal;
        target.hp = Math.min(target.maxHp, target.hp + amount);
        this._floater(target, "+" + amount, "#7bd06a", 14);
        target.flash = 1;
        return;
      }
      // attaque
      const dmg = Game.Entities.F.damage(Game.Entities.atkOf(actor), Game.Entities.armOf(target));
      target.hp -= dmg;
      target.flash = 1;
      this._floater(target, "-" + dmg, target.side === "hero" ? "#ff7a6a" : "#ffd9a0", 15);
      // soif de sang
      if (actor.talentKey === "soif_sang") {
        actor.hp = Math.min(actor.maxHp, actor.hp + 2);
        this._floater(actor, "+2", "#7bd06a", 10);
      }
      if (target.hp <= 0) {
        target.hp = 0; target.alive = false;
        this._floater(target, "✖", "#ffffff", 16);
        if (target.side === "enemy" && target.isCaptain) this.captainDead = true;
      }
    },

    /* ---------------- fin de combat ---------------- */
    _checkEnd() {
      if (this.state !== "fighting") return;
      if (this.livingEnemies().length === 0) { this._win(); }
      else if (this.livingHeroes().length === 0) { this._lose(); }
    },
    _win() {
      this.state = "won"; this.banner = "VICTOIRE !"; this.endTimer = 1.4;
    },
    _lose() {
      this.state = "lost"; this.banner = "DÉFAITE"; this.endTimer = 1.8;
    },
    _finalize() {
      const camp = this.camp, heroIds = this.heroes.map(h => h.id);
      this.active = false;
      if (this.state === "won") Game.grantVictory(camp, this.heroes);
      else Game.grantDefeat(camp, this.heroes);
      this.camp = null; this.heroes = []; this.enemies = []; this.units = [];
    },

    /* ---------------- textes flottants ---------------- */
    _floater(u, text, color, size) {
      const s = this._slot(u);
      this.floaters.push({ x: s.x + (Math.random() - 0.5) * 10, y: s.y - 14, vy: -34,
                           life: 1.0, max: 1.0, text, color, size: size || 13 });
    },
    _updateFloaters(dt) {
      for (const f of this.floaters) { f.y += f.vy * dt; f.vy += 24 * dt; f.life -= dt / 1.1; }
      this.floaters = this.floaters.filter(f => f.life > 0);
    },

    /* ---------------- positions des cartes (écran) ---------------- */
    layout() {
      const base = Game.World.worldToScreen(this.pos.x, this.pos.y);
      const view = Game.World.view;
      // ancré au camp mais maintenu lisible à l'écran
      let cx = base.x, cy = base.y - 10;
      cx = Math.max(120, Math.min(view.w - 120, cx));
      cy = Math.max(150, Math.min(view.h - 120, cy));
      return { cx, cy };
    },
    _slot(u) {
      const L = this.layout();
      const list = u.side === "hero" ? this.heroes : this.enemies;
      const n = list.length, sp = 40, totalH = (n - 1) * sp;
      const i = u.slotIndex;
      const x = L.cx + (u.side === "hero" ? -78 : 78);
      const y = L.cy - totalH / 2 + i * sp;
      return { x: x + (u.offX || 0), y: y + (u.offY || 0) };
    },

    /* ---------------- rendu ---------------- */
    render(ctx) {
      const L = this.layout();
      const n = Math.max(this.heroes.length, this.enemies.length);
      const h = n * 40 + 30;
      // fond
      ctx.save();
      ctx.fillStyle = "rgba(6,7,5,.72)";
      this._roundRect(ctx, L.cx - 116, L.cy - h / 2 - 18, 232, h + 30, 10); ctx.fill();
      ctx.strokeStyle = "rgba(120,40,34,.7)"; ctx.lineWidth = 2; ctx.stroke();
      // titre
      ctx.fillStyle = "#ffb4a8"; ctx.font = "bold 13px Georgia, serif"; ctx.textAlign = "center";
      ctx.fillText("⚔ " + (this.camp ? this.camp.name : ""), L.cx, L.cy - h / 2 - 4);
      // "VS"
      ctx.fillStyle = "#7c1f1a"; ctx.font = "bold 16px Georgia, serif";
      ctx.fillText("VS", L.cx, L.cy + 5);
      ctx.restore();

      for (const u of this.heroes) this._drawCard(ctx, u);
      for (const u of this.enemies) this._drawCard(ctx, u);

      // floaters
      for (const f of this.floaters) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life / f.max));
        ctx.font = "bold " + f.size + "px Georgia, serif"; ctx.textAlign = "center";
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.9)"; ctx.strokeText(f.text, f.x, f.y);
        ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
        ctx.restore();
      }

      // bannière de fin
      if (this.state !== "fighting") {
        ctx.save();
        ctx.font = "bold 30px Georgia, serif"; ctx.textAlign = "center";
        ctx.lineWidth = 5; ctx.strokeStyle = "rgba(0,0,0,.9)";
        ctx.strokeText(this.banner, L.cx, L.cy);
        ctx.fillStyle = this.state === "won" ? "#f4d488" : "#ff6f6f";
        ctx.fillText(this.banner, L.cx, L.cy);
        ctx.restore();
      }
    },

    _drawCard(ctx, u) {
      if (!u.alive && !u.fled && u.hp <= 0) { /* mort : on dessine grisé */ }
      const s = this._slot(u);
      const w = 70, hh = 32;
      const x = s.x - w / 2, y = s.y - hh / 2;
      const dead = !u.alive;

      ctx.save();
      ctx.globalAlpha = dead ? 0.35 : 1;
      // cadre
      ctx.fillStyle = u.side === "hero" ? "rgba(26,32,40,.95)" : "rgba(40,20,20,.95)";
      this._roundRect(ctx, x, y, w, hh, 4); ctx.fill();
      ctx.strokeStyle = u.flash > 0 ? "#ffffff" : (u.side === "hero" ? "#3a5a7a" : "#7a3a3a");
      ctx.lineWidth = u.flash > 0 ? 2.5 : 1.2; ctx.stroke();

      // portrait
      const pic = u.getPortrait();
      ctx.drawImage(pic, x + 2, y + 2, 28, 28);
      if (u.flash > 0) { ctx.fillStyle = "rgba(255,255,255," + (u.flash * 0.5) + ")"; ctx.fillRect(x + 2, y + 2, 28, 28); }

      // nom + niveau
      ctx.textAlign = "left"; ctx.font = "9px Segoe UI, sans-serif"; ctx.fillStyle = "#e8e0cf";
      const nm = (u.name.length > 11 ? u.name.slice(0, 10) + "…" : u.name);
      ctx.fillText(nm, x + 33, y + 9);
      ctx.fillStyle = "#9a937f"; ctx.fillText("Niv." + u.level, x + 33, y + 19);

      // barre PV
      const bw = 33, bx = x + 33, by = y + 22;
      ctx.fillStyle = "#1a1c15"; ctx.fillRect(bx, by, bw, 5);
      ctx.fillStyle = u.side === "hero" ? "#6fae5a" : "#c0392b";
      ctx.fillRect(bx, by, bw * Math.max(0, u.hp / u.maxHp), 5);
      ctx.strokeStyle = "#000"; ctx.lineWidth = 0.5; ctx.strokeRect(bx, by, bw, 5);

      // icônes atk/def + agilité (ordre d'action)
      ctx.font = "8px Segoe UI, sans-serif";
      ctx.fillStyle = "#ff9a8a"; ctx.fillText("✕" + Game.Entities.atkOf(u), x + 2, y + hh - 1);
      ctx.fillStyle = "#b9bcc4"; ctx.fillText("⛊" + Game.Entities.armOf(u), x + 22, y + hh - 1);

      // jauge d'agilité (petit liseré à gauche)
      ctx.fillStyle = "#2a2a1a"; ctx.fillRect(x - 3, y, 2, hh);
      ctx.fillStyle = "#7bd0ff"; const gh = hh * Math.min(1, u.gauge / THRESH);
      ctx.fillRect(x - 3, y + hh - gh, 2, gh);

      ctx.restore();
    },

    _roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },
  };

  Game.Combat = Combat;
})(window.Game = window.Game || {});
