/* =================================================================
   world.js — Carte du monde, caméra libre, rendu & interactions
   ================================================================= */
(function (Game) {
  "use strict";

  const World = {
    canvas: null, ctx: null, dpr: 1,
    view: { w: 0, h: 0 },
    bounds: { w: 2600, h: 3400 },
    scenery: [],
    villagers: [],
    keys: {},
    drag: { active: false, lastX: 0, lastY: 0, downX: 0, downY: 0, moved: false, pid: null },
    _t: 0,

    /* ---------------- init ---------------- */
    init() {
      this.canvas = document.getElementById("world");
      this.ctx = this.canvas.getContext("2d");
      if (Game.config && Game.config.world) this.bounds = Game.config.world;
      this.resize();
      window.addEventListener("resize", () => this.resize());

      const cv = this.canvas;
      cv.addEventListener("pointerdown", (e) => this.onDown(e));
      cv.addEventListener("pointermove", (e) => this.onMove(e));
      window.addEventListener("pointerup", (e) => this.onUp(e));
      cv.addEventListener("pointercancel", () => { this.drag.active = false; cv.classList.remove("dragging"); });
      window.addEventListener("keydown", (e) => this.onKey(e, true));
      window.addEventListener("keyup", (e) => this.onKey(e, false));
      // empêche le menu contextuel natif (drag droit éventuel)
      cv.addEventListener("contextmenu", (e) => e.preventDefault());
    },

    resize() {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.view.w = window.innerWidth;
      this.view.h = window.innerHeight;
      this.canvas.width = Math.floor(this.view.w * this.dpr);
      this.canvas.height = Math.floor(this.view.h * this.dpr);
      this.canvas.style.width = this.view.w + "px";
      this.canvas.style.height = this.view.h + "px";
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (Game.state) this.clampCamera();
    },

    /* ---------------- décor procédural (seedé) ---------------- */
    generate(seed) {
      const rng = Game.RNG.make((seed >>> 0) ^ 0x1234567);
      this.scenery = [];
      const reserved = this.reservedZones();
      const n = Math.floor((this.bounds.w * this.bounds.h) / 14000);
      for (let i = 0; i < n; i++) {
        const x = rng() * this.bounds.w, y = rng() * this.bounds.h;
        if (this.nearReserved(x, y, reserved, 90)) continue;
        const roll = rng();
        const type = roll < 0.7 ? "tree" : roll < 0.88 ? "bush" : "rock";
        this.scenery.push({ x, y, type, s: 0.7 + rng() * 0.8, seed: (rng() * 1e9) | 0 });
      }
      this.scenery.sort((a, b) => a.y - b.y);
      // villageois autour de l'hôtel de ville
      this.villagers = [];
      const th = Game.state.buildings.townhall.pos;
      for (let i = 0; i < 6; i++) {
        this.villagers.push({
          x: th.x + (rng() - 0.5) * 240, y: th.y + (rng() - 0.5) * 200,
          tx: th.x, ty: th.y, spd: 16 + rng() * 14, wait: rng() * 3,
          body: Game.RNG.pick(rng, ["#5b4a36", "#4a4036", "#6a5a44", "#403a30"]),
          head: "#caa07a", phase: rng() * 10,
        });
      }
    },
    reservedZones() {
      const z = [];
      const b = Game.state.buildings;
      for (const k in b) z.push(b[k].pos);
      for (const c of Game.state.camps) z.push(c.pos);
      return z;
    },
    nearReserved(x, y, zones, r) {
      for (const z of zones) if (Math.hypot(z.x - x, z.y - y) < r) return true;
      return false;
    },

    /* ---------------- caméra ---------------- */
    // Game.state.camera = point monde au CENTRE de l'écran.
    worldToScreen(wx, wy) {
      const c = Game.state.camera;
      return { x: wx - c.x + this.view.w / 2, y: wy - c.y + this.view.h / 2 };
    },
    screenToWorld(sx, sy) {
      const c = Game.state.camera;
      return { x: sx - this.view.w / 2 + c.x, y: sy - this.view.h / 2 + c.y };
    },
    clampCamera() {
      const c = Game.state.camera, hw = this.view.w / 2, hh = this.view.h / 2;
      c.x = this.bounds.w > this.view.w ? Math.max(hw, Math.min(this.bounds.w - hw, c.x)) : this.bounds.w / 2;
      c.y = this.bounds.h > this.view.h ? Math.max(hh, Math.min(this.bounds.h - hh, c.y)) : this.bounds.h / 2;
    },
    centerOn(wx, wy) { Game.state.camera.x = wx; Game.state.camera.y = wy; this.clampCamera(); },
    isOnScreen(wx, wy, margin = 80) {
      const s = this.worldToScreen(wx, wy);
      return s.x >= -margin && s.x <= this.view.w + margin && s.y >= -margin && s.y <= this.view.h + margin;
    },

    /* ---------------- update ---------------- */
    update(dt) {
      this._t += dt;
      // déplacement caméra clavier
      const sp = 460 * dt;
      const c = Game.state.camera;
      if (this.keys.ArrowLeft || this.keys.a) c.x -= sp;
      if (this.keys.ArrowRight || this.keys.d) c.x += sp;
      if (this.keys.ArrowUp || this.keys.w) c.y -= sp;
      if (this.keys.ArrowDown || this.keys.s) c.y += sp;
      this.clampCamera();
      this.updateVillagers(dt);
      this.updateIdleHeroes(dt);
    },

    updateVillagers(dt) {
      const th = Game.state.buildings.townhall.pos;
      for (const v of this.villagers) {
        v.wait -= dt;
        if (v.wait <= 0) {
          const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 150;
          v.tx = th.x + Math.cos(a) * r; v.ty = th.y + Math.sin(a) * r;
          v.wait = 1.5 + Math.random() * 3;
        }
        const dx = v.tx - v.x, dy = v.ty - v.y, d = Math.hypot(dx, dy);
        if (d > 2) { v.x += (dx / d) * v.spd * dt; v.y += (dy / d) * v.spd * dt; v.moving = true; }
        else v.moving = false;
      }
    },

    // Héros oisifs : errent dans le village de façon autonome.
    updateIdleHeroes(dt) {
      const th = Game.state.buildings.townhall.pos;
      for (const h of Game.state.heroes) {
        if (h.state !== "idle") continue;
        if (!h.wander || Math.hypot(h.wander.x - h.pos.x, h.wander.y - h.pos.y) < 6) {
          if (!h._wait || (h._wait -= dt) <= 0) {
            const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 170;
            h.wander = { x: th.x + Math.cos(a) * r, y: th.y + Math.sin(a) * r };
            h._wait = 1 + Math.random() * 3;
          }
        }
        if (h.wander) {
          const dx = h.wander.x - h.pos.x, dy = h.wander.y - h.pos.y, d = Math.hypot(dx, dy);
          if (d > 2) { const sp = 34 * dt; h.pos.x += (dx / d) * sp; h.pos.y += (dy / d) * sp; h._moving = true; }
          else h._moving = false;
        }
      }
    },

    /* ---------------- rendu ---------------- */
    render() {
      const x = this.ctx;
      this.drawGround();
      this.drawPaths();
      this.drawScenery();
      this.drawCamps();
      this.drawBuildings();
      this.drawChariots();
      this.drawVillagers();
      this.drawHeroes();
      this.drawMission();
      if (Game.Combat && Game.Combat.active) Game.Combat.render(x);
    },

    drawGround() {
      const x = this.ctx, c = Game.state.camera;
      // base sombre
      x.fillStyle = "#10160f"; x.fillRect(0, 0, this.view.w, this.view.h);
      // damier de terrain subtil (aligné au monde) pour donner du relief
      const tile = 96;
      const startX = Math.floor((c.x - this.view.w / 2) / tile) * tile;
      const startY = Math.floor((c.y - this.view.h / 2) / tile) * tile;
      for (let wy = startY; wy < c.y + this.view.h / 2 + tile; wy += tile) {
        for (let wx = startX; wx < c.x + this.view.w / 2 + tile; wx += tile) {
          const s = this.worldToScreen(wx, wy);
          const k = ((wx / tile) + (wy / tile)) & 1;
          x.fillStyle = k ? "#14200f" : "#121b0e";
          x.fillRect(s.x, s.y, tile + 1, tile + 1);
        }
      }
      // vignette globale
      const vg = x.createRadialGradient(this.view.w / 2, this.view.h / 2, this.view.h * 0.3,
                                        this.view.w / 2, this.view.h / 2, this.view.h * 0.75);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.55)");
      x.fillStyle = vg; x.fillRect(0, 0, this.view.w, this.view.h);
      // bords du monde (assombris)
      this.drawWorldEdges();
    },

    drawWorldEdges() {
      const x = this.ctx;
      const tl = this.worldToScreen(0, 0), br = this.worldToScreen(this.bounds.w, this.bounds.h);
      x.save();
      x.strokeStyle = "rgba(0,0,0,.6)"; x.lineWidth = 60;
      x.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      x.restore();
    },

    drawPaths() {
      const x = this.ctx, th = Game.state.buildings.townhall.pos;
      const targets = [];
      for (const k in Game.state.buildings) if (k !== "townhall") targets.push(Game.state.buildings[k].pos);
      for (const c of Game.state.camps) targets.push(c.pos);
      x.save(); x.lineCap = "round";
      for (const t of targets) {
        const a = this.worldToScreen(th.x, th.y), b = this.worldToScreen(t.x, t.y);
        x.strokeStyle = "rgba(60,48,34,.55)"; x.lineWidth = 20;
        x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
        x.strokeStyle = "rgba(86,70,48,.55)"; x.lineWidth = 11;
        x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
      }
      x.restore();
    },

    drawScenery() {
      const x = this.ctx;
      for (const o of this.scenery) {
        if (!this.isOnScreen(o.x, o.y, 60)) continue;
        const s = this.worldToScreen(o.x, o.y);
        if (o.type === "tree") this.drawTree(x, s.x, s.y, o.s);
        else if (o.type === "bush") this.drawBush(x, s.x, s.y, o.s);
        else this.drawRock(x, s.x, s.y, o.s);
      }
    },
    drawTree(x, px, py, s) {
      x.fillStyle = "rgba(0,0,0,.35)";
      x.beginPath(); x.ellipse(px, py + 2 * s, 12 * s, 4 * s, 0, 0, 7); x.fill();
      x.fillStyle = "#3a2c1c"; x.fillRect(px - 2 * s, py - 8 * s, 4 * s, 12 * s);
      const greens = ["#1f3a18", "#284a1d", "#1a3214"];
      for (let i = 0; i < 3; i++) {
        x.fillStyle = greens[i];
        x.beginPath();
        x.arc(px + (i - 1) * 6 * s, py - 14 * s - i * 2 * s, 11 * s - i * 1.5 * s, 0, 7);
        x.fill();
      }
    },
    drawBush(x, px, py, s) {
      x.fillStyle = "rgba(0,0,0,.3)";
      x.beginPath(); x.ellipse(px, py + 1 * s, 8 * s, 3 * s, 0, 0, 7); x.fill();
      x.fillStyle = "#24401b";
      x.beginPath(); x.arc(px - 4 * s, py, 5 * s, 0, 7); x.arc(px + 4 * s, py, 5 * s, 0, 7); x.arc(px, py - 3 * s, 6 * s, 0, 7); x.fill();
    },
    drawRock(x, px, py, s) {
      x.fillStyle = "rgba(0,0,0,.3)";
      x.beginPath(); x.ellipse(px, py + 2 * s, 10 * s, 3 * s, 0, 0, 7); x.fill();
      x.fillStyle = "#4a4d50"; x.strokeStyle = "#2c2e30"; x.lineWidth = 1.5;
      x.beginPath();
      x.moveTo(px - 9 * s, py + 3 * s); x.lineTo(px - 6 * s, py - 6 * s); x.lineTo(px + 2 * s, py - 8 * s);
      x.lineTo(px + 9 * s, py - 2 * s); x.lineTo(px + 7 * s, py + 4 * s); x.closePath(); x.fill(); x.stroke();
    },

    /* ---- bâtiments ---- */
    drawBuildings() {
      const b = Game.state.buildings;
      // ordre d'affichage par y
      const list = Object.values(b).sort((a, c) => a.pos.y - c.pos.y);
      for (const bld of list) {
        const s = this.worldToScreen(bld.pos.x, bld.pos.y);
        if (!this.isOnScreen(bld.pos.x, bld.pos.y, 160)) continue;
        if (bld.key === "townhall") this.drawTownhall(this.ctx, s.x, s.y, bld);
        else if (bld.key === "sawmill") this.drawSawmill(this.ctx, s.x, s.y, bld);
        else if (bld.key === "mine") this.drawMine(this.ctx, s.x, s.y, bld);
        // overlay d'amélioration (jauge noire/orange + compte à rebours)
        if (bld.upgrading) this.drawProgressBadge(s.x, s.y - 70,
          1 - bld.upgradeRemaining / (bld._upgradeDur || 1), Game.fmtTime(bld.upgradeRemaining));
        // pastille de stock pour producteurs
        if (bld.produces && !bld.upgrading) this.drawStockPip(s.x, s.y - 58, bld);
      }
    },

    drawTownhall(x, px, py, b) {
      const t = this._t;
      this.shadow(x, px, py, 46, 14);
      // remparts / sol pierre
      x.fillStyle = "#3a3a40"; x.beginPath(); x.ellipse(px, py, 52, 22, 0, 0, 7); x.fill();
      // maisons satellites (le village grandit avec le niveau)
      const houses = Math.min(6, 2 + Math.floor(b.level / 1));
      for (let i = 0; i < houses; i++) {
        const a = (i / houses) * Math.PI * 2, r = 40;
        this.drawHouse(x, px + Math.cos(a) * r, py + Math.sin(a) * r + 6, 0.7, t, i);
      }
      // donjon central
      x.fillStyle = "#6b6b54"; x.fillRect(px - 18, py - 30, 36, 32);
      x.fillStyle = "#5a5a46"; x.fillRect(px - 18, py - 30, 36, 6);
      // créneaux
      x.fillStyle = "#6b6b54";
      for (let i = 0; i < 4; i++) x.fillRect(px - 18 + i * 10, py - 36, 6, 6);
      // toit tour
      x.fillStyle = "#7a3b32"; x.beginPath();
      x.moveTo(px - 22, py - 30); x.lineTo(px, py - 48); x.lineTo(px + 22, py - 30); x.closePath(); x.fill();
      // porte
      x.fillStyle = "#2a1c12"; x.fillRect(px - 6, py - 12, 12, 14);
      // fenêtres lumineuses (pulsées)
      const glow = 0.6 + 0.4 * Math.sin(t * 2);
      x.fillStyle = `rgba(255,190,90,${0.5 + glow * 0.4})`;
      x.fillRect(px - 12, py - 22, 5, 6); x.fillRect(px + 7, py - 22, 5, 6);
      // drapeau
      x.strokeStyle = "#2a2018"; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(px, py - 48); x.lineTo(px, py - 60); x.stroke();
      x.fillStyle = "#b03a2e";
      const fw = 10 + Math.sin(t * 4) * 1.5;
      x.beginPath(); x.moveTo(px, py - 60); x.lineTo(px + fw, py - 57); x.lineTo(px, py - 54); x.fill();
      // fumée
      this.smoke(x, px - 14, py - 36, t);
      this.smoke(x, px + 16, py - 30, t + 1.5);
    },

    drawHouse(x, px, py, s, t, i) {
      x.fillStyle = "rgba(0,0,0,.3)"; x.beginPath(); x.ellipse(px, py + 6 * s, 16 * s, 5 * s, 0, 0, 7); x.fill();
      x.fillStyle = "#574734"; x.fillRect(px - 12 * s, py - 8 * s, 24 * s, 16 * s);
      x.fillStyle = "#6e3a30"; x.beginPath();
      x.moveTo(px - 15 * s, py - 8 * s); x.lineTo(px, py - 20 * s); x.lineTo(px + 15 * s, py - 8 * s); x.closePath(); x.fill();
      const g = 0.5 + 0.5 * Math.sin(t * 2 + i);
      x.fillStyle = `rgba(255,190,90,${0.4 + g * 0.4})`;
      x.fillRect(px - 4 * s, py - 4 * s, 7 * s, 7 * s);
    },

    drawSawmill(x, px, py, b) {
      const t = this._t;
      this.shadow(x, px, py, 36, 12);
      // cabane
      x.fillStyle = "#5a4632"; x.fillRect(px - 24, py - 18, 48, 24);
      x.fillStyle = "#6e3a30"; x.beginPath();
      x.moveTo(px - 28, py - 18); x.lineTo(px, py - 34); x.lineTo(px + 28, py - 18); x.closePath(); x.fill();
      // tas de rondins (croît avec le niveau)
      const logs = Math.min(8, 2 + b.level);
      x.fillStyle = "#7a5a38"; x.strokeStyle = "#3a2c1c"; x.lineWidth = 1;
      for (let i = 0; i < logs; i++) {
        const lx = px - 30 + (i % 4) * 9, ly = py + 8 + Math.floor(i / 4) * 7;
        x.beginPath(); x.ellipse(lx, ly, 4.5, 3.5, 0, 0, 7); x.fill(); x.stroke();
        x.fillStyle = "#a07a48"; x.beginPath(); x.arc(lx, ly, 1.6, 0, 7); x.fill(); x.fillStyle = "#7a5a38";
      }
      // roue de scie qui tourne
      x.save(); x.translate(px + 16, py - 6); x.rotate(t * 3);
      x.strokeStyle = "#b9bcc4"; x.lineWidth = 2; x.beginPath(); x.arc(0, 0, 7, 0, 7); x.stroke();
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * 7, Math.sin(a) * 7); x.stroke(); }
      x.restore();
      // fenêtre + fumée
      x.fillStyle = `rgba(255,190,90,${0.5 + 0.3 * Math.sin(t * 2)})`; x.fillRect(px - 18, py - 12, 6, 6);
      this.smoke(x, px - 20, py - 24, t);
      this.label(x, px, py + 26, b.name + " · Niv." + b.level);
    },

    drawMine(x, px, py, b) {
      const t = this._t;
      this.shadow(x, px, py, 34, 12);
      // monticule rocheux
      x.fillStyle = "#4a4d50"; x.beginPath();
      x.moveTo(px - 28, py + 6); x.lineTo(px - 16, py - 20); x.lineTo(px + 4, py - 26);
      x.lineTo(px + 22, py - 14); x.lineTo(px + 28, py + 6); x.closePath(); x.fill();
      x.fillStyle = "#3a3d40"; x.beginPath();
      x.moveTo(px - 10, py - 18); x.lineTo(px + 6, py - 22); x.lineTo(px + 14, py - 10); x.lineTo(px - 4, py - 6); x.closePath(); x.fill();
      // entrée (le trou) — encadré de bois si niveau >= 2
      x.fillStyle = "#0a0a0a"; x.beginPath(); x.ellipse(px, py - 2, 9, 8, 0, 0, 7); x.fill();
      if (b.level >= 2) {
        x.strokeStyle = "#5a4632"; x.lineWidth = 3;
        x.beginPath(); x.moveTo(px - 10, py + 5); x.lineTo(px - 9, py - 9); x.lineTo(px + 9, py - 9); x.lineTo(px + 10, py + 5); x.stroke();
      }
      // wagonnet
      x.fillStyle = "#3a2c1c"; x.fillRect(px + 12, py + 2, 12, 7);
      x.fillStyle = "#b9bcc4"; x.beginPath(); x.arc(px + 15, py + 9, 2, 0, 7); x.arc(px + 21, py + 9, 2, 0, 7); x.fill();
      // minerai brillant
      x.fillStyle = `rgba(255,210,120,${0.4 + 0.3 * Math.sin(t * 3)})`;
      x.beginPath(); x.arc(px - 14, py - 2, 1.8, 0, 7); x.arc(px + 4, py + 2, 1.6, 0, 7); x.fill();
      this.label(x, px, py + 24, b.name + " · Niv." + b.level);
    },

    /* ---- camps ennemis ---- */
    drawCamps() {
      for (const c of Game.state.camps) {
        if (!this.isOnScreen(c.pos.x, c.pos.y, 160)) continue;
        const s = this.worldToScreen(c.pos.x, c.pos.y);
        this.drawGoblinCamp(this.ctx, s.x, s.y, c);
        const alive = c.enemies.filter(e => e.hp > 0).length;
        const txt = c.cleared ? c.name + " (vaincu)" : c.name + " · " + alive + " ennemis";
        this.label(this.ctx, s.x, s.y + 34, txt, c.cleared ? "#9a937f" : "#ff8a7a");
      }
    },
    drawGoblinCamp(x, px, py, c) {
      const t = this._t;
      this.shadow(x, px, py, 40, 14);
      // palissade
      x.strokeStyle = "#3a2c1c"; x.lineWidth = 3;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2, r = 34;
        const sx = px + Math.cos(a) * r, sy = py + Math.sin(a) * r * 0.7 + 6;
        x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx, sy - 12); x.stroke();
        x.beginPath(); x.moveTo(sx, sy - 12); x.lineTo(sx - 2, sy - 16); x.lineTo(sx + 2, sy - 16); x.fill();
      }
      // tentes
      const tents = c.cleared ? 1 : 3;
      for (let i = 0; i < tents; i++) {
        const tx = px + (i - 1) * 16, ty = py - 2 + (i % 2) * 6;
        x.fillStyle = "#4a3a26"; x.beginPath();
        x.moveTo(tx - 11, ty + 6); x.lineTo(tx, ty - 10); x.lineTo(tx + 11, ty + 6); x.closePath(); x.fill();
        x.fillStyle = "#2a1c12"; x.beginPath();
        x.moveTo(tx - 3, ty + 6); x.lineTo(tx, ty - 2); x.lineTo(tx + 3, ty + 6); x.closePath(); x.fill();
      }
      // feu de camp animé
      if (!c.cleared) {
        const fy = py + 10, fl = 4 + Math.sin(t * 12) * 1.5;
        x.fillStyle = "#3a2c1c"; x.fillRect(px - 5, fy, 10, 3);
        x.fillStyle = "#ff7a2a"; x.beginPath(); x.moveTo(px - 3, fy); x.quadraticCurveTo(px, fy - 8 - fl, px + 3, fy); x.fill();
        x.fillStyle = "#ffd24a"; x.beginPath(); x.moveTo(px - 1.5, fy); x.quadraticCurveTo(px, fy - 4 - fl, px + 1.5, fy); x.fill();
      }
      // bannière crâne
      x.strokeStyle = "#2a2018"; x.lineWidth = 1.5; x.beginPath(); x.moveTo(px + 24, py + 4); x.lineTo(px + 24, py - 18); x.stroke();
      x.fillStyle = "#6a1f1a"; x.fillRect(px + 24, py - 18, 12, 9);
      x.fillStyle = "#e8e0cf"; x.beginPath(); x.arc(px + 30, py - 14, 2.2, 0, 7); x.fill();
    },

    /* ---- chariots ---- */
    drawChariots() {
      for (const ch of Game.state.chariots) {
        if (!this.isOnScreen(ch.pos.x, ch.pos.y, 40)) continue;
        const s = this.worldToScreen(ch.pos.x, ch.pos.y);
        this.drawCart(this.ctx, s.x, s.y, ch);
      }
    },
    drawCart(x, px, py, ch) {
      const t = this._t;
      this.shadow(x, px, py, 12, 4);
      x.save(); x.translate(px, py);
      // benne
      x.fillStyle = "#5a4632"; x.strokeStyle = "#2a2018"; x.lineWidth = 1;
      x.fillRect(-9, -8, 18, 9); x.strokeRect(-9, -8, 18, 9);
      // cargaison visible
      if (ch.cargo > 0) {
        x.fillStyle = ch.cargoType === "wood" ? "#7a5a38" : "#9aa0a6";
        x.fillRect(-7, -12, 14, 5);
      }
      // roues qui tournent
      const rot = t * 6 * (ch.state === "to_source" || ch.state === "to_home" ? 1 : 0);
      x.fillStyle = "#2a2018";
      for (const wx of [-6, 6]) {
        x.save(); x.translate(wx, 3); x.rotate(rot);
        x.beginPath(); x.arc(0, 0, 4, 0, 7); x.fill();
        x.strokeStyle = "#6a5a44"; x.lineWidth = 1;
        x.beginPath(); x.moveTo(-4, 0); x.lineTo(4, 0); x.moveTo(0, -4); x.lineTo(0, 4); x.stroke();
        x.restore();
      }
      x.restore();
    },

    drawVillagers() {
      for (const v of this.villagers) {
        if (!this.isOnScreen(v.x, v.y, 30)) continue;
        const s = this.worldToScreen(v.x, v.y);
        Game.Art.drawWalker(this.ctx, s.x, s.y, 0.85, v.body, v.head, v.moving ? this._t + v.phase : v.phase * 0.0);
      }
    },

    /* ---- héros sur la carte ---- */
    drawHeroes() {
      for (const h of Game.state.heroes) {
        if (h.state !== "idle") continue;                // mission/combat/blessé : non dessinés ici
        if (!this.isOnScreen(h.pos.x, h.pos.y, 40)) continue;
        const s = this.worldToScreen(h.pos.x, h.pos.y);
        // cercle bleu de sélection
        if (Game.state.selection.includes(h.id)) {
          const x = this.ctx, pulse = 1 + 0.08 * Math.sin(this._t * 5);
          x.strokeStyle = "rgba(79,151,224,.9)"; x.lineWidth = 2;
          x.beginPath(); x.ellipse(s.x, s.y + 2, 11 * pulse, 5 * pulse, 0, 0, 7); x.stroke();
          x.strokeStyle = "rgba(111,192,255,.4)"; x.lineWidth = 4;
          x.beginPath(); x.ellipse(s.x, s.y + 2, 11 * pulse, 5 * pulse, 0, 0, 7); x.stroke();
        }
        Game.Art.drawWalker(this.ctx, s.x, s.y, 1.1, h.color, "#e8c89a", h._moving ? this._t : 0);
        // petit nom
        this.label(this.ctx, s.x, s.y - 18, h.name.split(" ")[0], "#cfe6ff", 10);
      }
    },

    // Groupe en mission : déplacement + compte à rebours au-dessus.
    drawMission() {
      const m = Game.state.mission;
      if (!m || m.state !== "traveling") return;
      if (!this.isOnScreen(m.pos.x, m.pos.y, 60)) return;
      const s = this.worldToScreen(m.pos.x, m.pos.y);
      // mini groupe
      for (let i = 0; i < Math.min(3, m.heroIds.length); i++) {
        const h = Game.heroById(m.heroIds[i]);
        if (h) Game.Art.drawWalker(this.ctx, s.x + (i - 1) * 8, s.y + (i % 2) * 4, 1.0, h.color, "#e8c89a", this._t + i);
      }
      this.drawProgressBadge(s.x, s.y - 28, m.progress, Game.fmtTime(m.remaining * 1000));
    },

    /* ---- overlays ---- */
    drawProgressBadge(px, py, ratio, text) {
      const x = this.ctx, w = 56, h = 9;
      x.save();
      x.fillStyle = "rgba(0,0,0,.85)"; x.fillRect(px - w / 2 - 1, py - 1, w + 2, h + 2);
      x.fillStyle = "#221a10"; x.fillRect(px - w / 2, py, w, h);
      x.fillStyle = "#ff8c1a"; x.fillRect(px - w / 2, py, w * Math.max(0, Math.min(1, ratio)), h);
      x.fillStyle = "#ffe7c2"; x.font = "8px monospace"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(text, px, py + h / 2 + 0.5);
      x.restore();
    },
    drawStockPip(px, py, b) {
      const x = this.ctx, ratio = b.localStock / b.capacity;
      x.save();
      x.fillStyle = "rgba(0,0,0,.7)"; x.fillRect(px - 18, py, 36, 6);
      x.fillStyle = b.produces === "wood" ? "#a9c26a" : "#b9bcc4";
      x.fillRect(px - 18, py, 36 * Math.min(1, ratio), 6);
      x.restore();
    },

    /* ---- petits helpers de dessin ---- */
    shadow(x, px, py, rx, ry) { x.fillStyle = "rgba(0,0,0,.4)"; x.beginPath(); x.ellipse(px, py + 4, rx, ry, 0, 0, 7); x.fill(); },
    smoke(x, px, py, t) {
      x.save();
      for (let i = 0; i < 4; i++) {
        const p = (t * 0.5 + i * 0.25) % 1;
        x.globalAlpha = (1 - p) * 0.35;
        x.fillStyle = "#9a937f";
        x.beginPath(); x.arc(px + Math.sin((t + i) * 2) * 4, py - p * 26, 3 + p * 6, 0, 7); x.fill();
      }
      x.restore();
    },
    label(x, px, py, text, color, size) {
      x.save();
      x.font = (size || 11) + "px " + "Segoe UI, sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle";
      x.lineWidth = 3; x.strokeStyle = "rgba(0,0,0,.85)"; x.strokeText(text, px, py);
      x.fillStyle = color || "#e8e0cf"; x.fillText(text, px, py);
      x.restore();
    },

    /* ---------------- entrées ---------------- */
    onKey(e, down) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        this.keys[e.key] = down; e.preventDefault();
      } else { this.keys[e.key.toLowerCase()] = down; }
    },
    onDown(e) {
      if (Game.state.paused) return;
      this.drag.active = true; this.drag.pid = e.pointerId;
      this.drag.lastX = this.drag.downX = e.clientX;
      this.drag.lastY = this.drag.downY = e.clientY;
      this.drag.moved = false;
      this.canvas.classList.add("dragging");
    },
    onMove(e) {
      if (!this.drag.active) return;
      const dx = e.clientX - this.drag.lastX, dy = e.clientY - this.drag.lastY;
      this.drag.lastX = e.clientX; this.drag.lastY = e.clientY;
      Game.state.camera.x -= dx; Game.state.camera.y -= dy;
      this.clampCamera();
      if (Math.hypot(e.clientX - this.drag.downX, e.clientY - this.drag.downY) > 6) this.drag.moved = true;
    },
    onUp(e) {
      if (!this.drag.active) return;
      this.drag.active = false; this.canvas.classList.remove("dragging");
      if (!this.drag.moved) this.handleClick(e.clientX, e.clientY); // c'était un clic, pas un pan
    },

    handleClick(sx, sy) {
      const w = this.screenToWorld(sx, sy);
      Game.UI.closeCampMenu();
      // 1) héros ?
      let hero = null, hd = 22;
      for (const h of Game.state.heroes) {
        if (h.state !== "idle") continue;
        const d = Math.hypot(h.pos.x - w.x, h.pos.y - w.y);
        if (d < hd) { hd = d; hero = h; }
      }
      if (hero) { Game.toggleSelect(hero.id); return; }
      // 2) camp ?
      for (const c of Game.state.camps) {
        if (Math.hypot(c.pos.x - w.x, c.pos.y - w.y) < 42) { Game.UI.openCampMenu(c); return; }
      }
      // 3) bâtiment ?
      for (const k in Game.state.buildings) {
        const b = Game.state.buildings[k];
        if (Math.hypot(b.pos.x - w.x, b.pos.y - w.y) < 46) { Game.UI.openBuildingPanel(b); return; }
      }
      // 4) sol vide : désélection
      Game.clearSelection();
      Game.UI.closeBuildingPanel();
    },
  };

  Game.World = World;
})(window.Game = window.Game || {});
