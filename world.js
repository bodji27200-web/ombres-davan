/* =================================================================
   world.js – Carte du monde, caméra libre, rendu & interactions
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
      // particules d'ambiance : braises montantes + lucioles dérivantes
      this.particles = [];
      for (let i = 0; i < 110; i++) {
        this.particles.push({
          x: rng() * this.bounds.w, y: rng() * this.bounds.h,
          spd: 5 + rng() * 12, sway: (rng() - 0.5) * 10, phase: rng() * 6.28,
          r: 0.6 + rng() * 1.3, ember: rng() < 0.55, life: rng(),
        });
      }
      // feuilles/cendres qui retombent (contre-mouvement, donne de la profondeur)
      this.leaves = [];
      for (let i = 0; i < 26; i++) {
        this.leaves.push({
          x: rng() * this.bounds.w, y: rng() * this.bounds.h,
          spd: 8 + rng() * 10, sway: 14 + rng() * 16, phase: rng() * 6.28,
          rot: rng() * 6.28, rspd: (rng() - 0.5) * 3, s: 1 + rng() * 1.4,
          ash: rng() < 0.4,
        });
      }
      // mares / marécages (signature swamp) – évite les zones réservées
      this.ponds = [];
      for (let i = 0; i < 7; i++) {
        const x = rng() * this.bounds.w, y = rng() * this.bounds.h;
        if (this.nearReserved(x, y, reserved, 160)) continue;
        this.ponds.push({ x, y, rx: 48 + rng() * 70, ry: 26 + rng() * 36, seed: (rng() * 1e9) | 0 });
      }
      // roseaux autour des mares
      this.reeds = [];
      for (const p of this.ponds) {
        const k = 8 + ((p.seed % 6) | 0);
        for (let j = 0; j < k; j++) {
          const a = rng() * 6.28, rr = 0.8 + rng() * 0.35;
          this.reeds.push({ x: p.x + Math.cos(a) * p.rx * rr, y: p.y + Math.sin(a) * p.ry * rr,
                            h: 10 + rng() * 14, phase: rng() * 6.28, lean: (rng() - 0.5) });
        }
      }
      // décals au sol : taches usées, ossements, champignons luisants
      this.decals = [];
      const nd = Math.floor((this.bounds.w * this.bounds.h) / 26000);
      for (let i = 0; i < nd; i++) {
        const x = rng() * this.bounds.w, y = rng() * this.bounds.h;
        if (this.nearReserved(x, y, reserved, 70)) continue;
        const roll = rng();
        const kind = roll < 0.55 ? "patch" : roll < 0.8 ? "bones" : "mushroom";
        this.decals.push({ x, y, kind, s: 0.7 + rng() * 0.8, rot: rng() * 6.28, phase: rng() * 6.28 });
      }
      // corbeaux qui traversent la carte
      this.crows = [];
      for (let i = 0; i < 3; i++) {
        this.crows.push({
          x: rng() * this.bounds.w, y: rng() * this.bounds.h, dir: rng() < 0.5 ? 1 : -1,
          spd: 38 + rng() * 26, alt: 30 + rng() * 50, phase: rng() * 6.28, wing: rng() * 6.28,
        });
      }
      this.terrain = null; // (re)génère la texture de sol au prochain rendu
    },

    /* ---------------- texture de sol painterly (générée 1x) ---------------- */
    buildTerrain() {
      const SC = 0.5;                                  // demi-résolution (perf)
      const W = Math.ceil(this.bounds.w * SC), H = Math.ceil(this.bounds.h * SC);
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const x = cv.getContext("2d");
      const rng = Game.RNG.make(0xA17E5 ^ (this.bounds.w | 0));
      // fond terre chaude
      const base = x.createLinearGradient(0, 0, 0, H);
      base.addColorStop(0, "#241d12"); base.addColorStop(0.5, "#1d1810"); base.addColorStop(1, "#15110b");
      x.fillStyle = base; x.fillRect(0, 0, W, H);
      // plaques de terre / mousse / herbe morte, posées en taches douces
      const tones = ["#2b2516", "#322a18", "#26301a", "#3a2f1c", "#1c2412", "#2e2415", "#382a1a"];
      const blots = Math.floor(W * H / 5200);
      for (let i = 0; i < blots; i++) {
        const px = rng() * W, py = rng() * H, r = (14 + rng() * 64) * SC * 2;
        const col = tones[(rng() * tones.length) | 0];
        const g = x.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)");
        x.globalAlpha = 0.22 + rng() * 0.3; x.fillStyle = g;
        x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
      }
      // mouchetis fin (grain de sol)
      x.globalAlpha = 1;
      for (let i = 0; i < W * H / 90; i++) {
        const px = rng() * W, py = rng() * H;
        x.fillStyle = rng() < 0.5 ? "rgba(0,0,0,.22)" : "rgba(180,150,90,.05)";
        x.fillRect(px, py, 1, 1);
      }
      this.terrain = cv; this.terrainScale = 1 / SC;
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
      this.updateParticles(dt);
    },

    updateParticles(dt) {
      if (!this.particles) return;
      for (const p of this.particles) {
        p.y -= p.spd * dt;                                  // monte
        p.x += Math.sin(this._t * 1.3 + p.phase) * p.sway * dt;
        p.life += dt * 0.3;
        if (p.y < Game.state.camera.y - this.view.h) {       // recycle au-dessus -> recrée en bas
          p.y = Game.state.camera.y + this.view.h / 2 + Math.random() * 40;
          p.x = Game.state.camera.x + (Math.random() - 0.5) * this.view.w;
        }
      }
      // feuilles/cendres : retombent
      if (this.leaves) for (const l of this.leaves) {
        l.y += l.spd * dt;
        l.x += Math.sin(this._t * 0.9 + l.phase) * l.sway * dt;
        l.rot += l.rspd * dt;
        if (l.y > Game.state.camera.y + this.view.h) {
          l.y = Game.state.camera.y - this.view.h / 2 - Math.random() * 40;
          l.x = Game.state.camera.x + (Math.random() - 0.5) * this.view.w;
        }
      }
      // corbeaux : traversent et bouclent
      if (this.crows) for (const cr of this.crows) {
        cr.x += cr.dir * cr.spd * dt;
        cr.y += Math.sin(this._t * 0.6 + cr.phase) * 10 * dt;
        cr.wing += dt * 10;
        if (cr.dir > 0 && cr.x > this.bounds.w + 80) { cr.x = -80; cr.y = Math.random() * this.bounds.h; }
        if (cr.dir < 0 && cr.x < -80) { cr.x = this.bounds.w + 80; cr.y = Math.random() * this.bounds.h; }
      }
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
      this.drawPonds();
      this.drawDecals();
      this.drawPaths();
      this.drawScenery();
      this.drawReeds();
      this.drawCamps();
      this.drawBuildings();
      this.drawChariots();
      this.drawVillagers();
      this.drawHeroes();
      this.drawMission();
      this.drawHover();
      this.drawCrows();
      this.drawAtmosphere();
      if (Game.Combat && Game.Combat.active) Game.Combat.render(x);
    },

    drawGround() {
      const x = this.ctx, c = Game.state.camera;
      if (!this.terrain) this.buildTerrain();
      // socle
      x.fillStyle = "#15110b"; x.fillRect(0, 0, this.view.w, this.view.h);
      // texture de terre painterly (portion visible)
      const sx = c.x - this.view.w / 2, sy = c.y - this.view.h / 2;
      const sc = this.terrainScale;
      x.imageSmoothingEnabled = true;
      x.drawImage(this.terrain,
        sx / sc, sy / sc, this.view.w / sc, this.view.h / sc,
        0, 0, this.view.w, this.view.h);
      // ombrage directionnel doux + vignette chaude (dégradés mis en cache, refaits au resize seulement)
      if (!this._gShade || this._gShadeH !== this.view.h) {
        const lg = x.createLinearGradient(0, 0, 0, this.view.h);
        lg.addColorStop(0, "rgba(70,56,34,.10)"); lg.addColorStop(0.45, "rgba(0,0,0,0)"); lg.addColorStop(1, "rgba(0,0,0,.22)");
        const vg = x.createRadialGradient(this.view.w / 2, this.view.h * 0.42, this.view.h * 0.28,
                                          this.view.w / 2, this.view.h * 0.5, this.view.h * 0.8);
        vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(8,4,2,.58)");
        this._gShade = lg; this._gVig = vg; this._gShadeH = this.view.h;
      }
      x.fillStyle = this._gShade; x.fillRect(0, 0, this.view.w, this.view.h);
      x.fillStyle = this._gVig;   x.fillRect(0, 0, this.view.w, this.view.h);
      this.drawWorldEdges();
    },

    // braises + lucioles + nappes de brume, par-dessus le monde
    drawAtmosphere() {
      const x = this.ctx, t = this._t;
      if (!this.particles) return;
      // brume basse dérivante (2 nappes) – sprite pré-rendu, repositionné (0 gradient/frame)
      x.save(); x.globalCompositeOperation = "screen";
      const fog = this.glowSprite("120,120,100");
      for (let i = 0; i < 2; i++) {
        const ox = Math.sin(t * 0.08 + i * 2) * 80;
        const cy = this.view.h * (0.6 + i * 0.18), R = this.view.w * 0.6;
        x.globalAlpha = 0.05;
        x.drawImage(fog, this.view.w / 2 + ox - R, cy - R, R * 2, R * 2);
      }
      x.restore();
      // particules (braises + lucioles)
      x.save(); x.globalCompositeOperation = "lighter";
      for (const p of this.particles) {
        const s = this.worldToScreen(p.x, p.y);
        if (s.x < -20 || s.x > this.view.w + 20 || s.y < -20 || s.y > this.view.h + 20) continue;
        const fl = 0.5 + 0.5 * Math.sin(t * 4 + p.phase);
        if (p.ember) { x.fillStyle = "rgba(255,150,60," + (0.25 + fl * 0.4) + ")"; }
        else         { x.fillStyle = "rgba(180,230,160," + (0.12 + fl * 0.22) + ")"; }
        x.beginPath(); x.arc(s.x, s.y, p.r * (0.7 + fl * 0.5), 0, 7); x.fill();
      }
      x.restore();
      // feuilles / cendres qui retombent
      if (this.leaves) {
        x.save();
        for (const l of this.leaves) {
          const s = this.worldToScreen(l.x, l.y);
          if (s.x < -20 || s.x > this.view.w + 20 || s.y < -20 || s.y > this.view.h + 20) continue;
          x.save(); x.translate(s.x, s.y); x.rotate(l.rot);
          if (l.ash) { x.fillStyle = "rgba(150,140,120,.28)"; x.beginPath(); x.arc(0, 0, 1 * l.s, 0, 7); x.fill(); }
          else { x.fillStyle = "rgba(120,90,40,.45)"; x.beginPath();
                 x.ellipse(0, 0, 2.4 * l.s, 1.1 * l.s, 0, 0, 7); x.fill(); }
          x.restore();
        }
        x.restore();
      }
      // rayons de lumière obliques (god rays) depuis le haut
      x.save(); x.globalCompositeOperation = "screen";
      const ray = this.glowSprite("255,228,170");
      for (let i = 0; i < 3; i++) {
        const bx = this.view.w * (0.2 + i * 0.3) + Math.sin(t * 0.05 + i) * 40;
        x.globalAlpha = 0.04 + 0.02 * Math.sin(t * 0.4 + i);
        x.save(); x.translate(bx, -40); x.rotate(0.32); x.scale(0.5, 3.2);
        x.drawImage(ray, -this.view.h * 0.5, 0, this.view.h, this.view.h); x.restore();
      }
      x.restore();
      // pulsation d'ambiance braise (respiration globale très subtile)
      x.save(); x.globalCompositeOperation = "screen"; x.globalAlpha = 0.04 + 0.03 * Math.sin(t * 0.7);
      const breathe = this.glowSprite("180,70,30");
      const BR = this.view.w * 0.9;
      x.drawImage(breathe, this.view.w / 2 - BR, this.view.h * 0.62 - BR, BR * 2, BR * 2);
      x.restore();
    },

    // sprite de halo radial pré-rendu (1x par couleur), réutilisé en drawImage → 0 gradient/frame
    glowSprite(rgb) {
      if (!this._glowCache) this._glowCache = {};
      let spr = this._glowCache[rgb];
      if (!spr) {
        const S = 128; spr = document.createElement("canvas"); spr.width = spr.height = S;
        const gx = spr.getContext("2d");
        const g = gx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        g.addColorStop(0, "rgba(" + rgb + ",1)"); g.addColorStop(0.5, "rgba(" + rgb + ",.35)");
        g.addColorStop(1, "rgba(" + rgb + ",0)");
        gx.fillStyle = g; gx.fillRect(0, 0, S, S);
        this._glowCache[rgb] = spr;
      }
      return spr;
    },
    // halo de lumière chaude additif (firelight) – rgb = "r,g,b", alpha 0..1
    glow(px, py, r, rgb, alpha) {
      const x = this.ctx, spr = this.glowSprite(rgb);
      x.save(); x.globalCompositeOperation = "lighter";
      x.globalAlpha = alpha == null ? 1 : alpha;
      x.drawImage(spr, px - r, py - r, r * 2, r * 2);
      x.restore();
    },

    drawWorldEdges() {
      const x = this.ctx;
      const tl = this.worldToScreen(0, 0), br = this.worldToScreen(this.bounds.w, this.bounds.h);
      x.save();
      x.strokeStyle = "rgba(0,0,0,.6)"; x.lineWidth = 60;
      x.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      x.restore();
    },

    /* ---- mares / marécages ---- */
    drawPonds() {
      if (!this.ponds) return;
      const x = this.ctx, t = this._t;
      for (const p of this.ponds) {
        if (!this.isOnScreen(p.x, p.y, Math.max(p.rx, p.ry) + 30)) continue;
        const s = this.worldToScreen(p.x, p.y);
        // berge sombre humide
        x.fillStyle = "rgba(10,14,10,.55)";
        x.beginPath(); x.ellipse(s.x, s.y, p.rx + 8, p.ry + 6, 0, 0, 7); x.fill();
        // eau (dégradé vert-noir trouble)
        const g = x.createRadialGradient(s.x, s.y - p.ry * 0.3, 2, s.x, s.y, p.rx);
        g.addColorStop(0, "#243a2e"); g.addColorStop(0.7, "#16241c"); g.addColorStop(1, "#0c140f");
        x.fillStyle = g;
        x.beginPath(); x.ellipse(s.x, s.y, p.rx, p.ry, 0, 0, 7); x.fill();
        // reflets ondulants (firelight chaud sur l'eau)
        x.save(); x.beginPath(); x.ellipse(s.x, s.y, p.rx, p.ry, 0, 0, 7); x.clip();
        x.globalCompositeOperation = "lighter";
        for (let i = 0; i < 3; i++) {
          const yy = s.y - p.ry * 0.4 + i * p.ry * 0.5 + Math.sin(t * 1.5 + i + p.seed) * 2;
          x.strokeStyle = "rgba(255,170,90," + (0.05 + 0.04 * Math.sin(t * 2 + i)) + ")"; x.lineWidth = 2;
          x.beginPath(); x.ellipse(s.x, yy, p.rx * (0.7 - i * 0.15), 2.4, 0, 0, Math.PI); x.stroke();
        }
        // ciel pâle reflété
        x.strokeStyle = "rgba(150,170,180,.06)"; x.lineWidth = 1.4;
        x.beginPath(); x.ellipse(s.x, s.y - p.ry * 0.2, p.rx * 0.8, 3, 0, 0, Math.PI); x.stroke();
        x.restore();
        // nénuphars occasionnels
        if ((p.seed & 3) === 0) {
          x.fillStyle = "#22401f";
          x.beginPath(); x.ellipse(s.x + p.rx * 0.3, s.y, 5, 3, 0, 0, 7); x.fill();
          x.beginPath(); x.ellipse(s.x - p.rx * 0.25, s.y + p.ry * 0.3, 4, 2.5, 0, 0, 7); x.fill();
        }
      }
    },
    drawReeds() {
      if (!this.reeds) return;
      const x = this.ctx, t = this._t;
      x.strokeStyle = "#3a4a26"; x.lineCap = "round";
      for (const r of this.reeds) {
        if (!this.isOnScreen(r.x, r.y, 30)) continue;
        const s = this.worldToScreen(r.x, r.y);
        const sway = Math.sin(t * 1.4 + r.phase) * 3 + r.lean * 4;
        x.lineWidth = 1.4;
        x.beginPath(); x.moveTo(s.x, s.y); x.quadraticCurveTo(s.x + sway * 0.5, s.y - r.h * 0.6, s.x + sway, s.y - r.h); x.stroke();
        // épi brun
        x.fillStyle = "#5a3a1e";
        x.beginPath(); x.ellipse(s.x + sway, s.y - r.h, 1.4, 3.4, 0, 0, 7); x.fill();
      }
    },
    /* ---- décals au sol ---- */
    drawDecals() {
      if (!this.decals) return;
      const x = this.ctx, t = this._t;
      for (const d of this.decals) {
        if (!this.isOnScreen(d.x, d.y, 30)) continue;
        const s = this.worldToScreen(d.x, d.y);
        if (d.kind === "patch") {
          x.fillStyle = "rgba(20,15,9,.34)";
          x.beginPath(); x.ellipse(s.x, s.y, 13 * d.s, 8 * d.s, d.rot, 0, 7); x.fill();
        } else if (d.kind === "bones") {
          x.save(); x.translate(s.x, s.y); x.rotate(d.rot);
          x.strokeStyle = "rgba(220,212,196,.5)"; x.lineWidth = 1.6 * d.s; x.lineCap = "round";
          x.beginPath(); x.moveTo(-5 * d.s, 0); x.lineTo(5 * d.s, 0); x.stroke();
          x.beginPath(); x.arc(-5 * d.s, -1.4 * d.s, 1.3 * d.s, 0, 7); x.arc(-5 * d.s, 1.4 * d.s, 1.3 * d.s, 0, 7);
          x.arc(5 * d.s, -1.4 * d.s, 1.3 * d.s, 0, 7); x.arc(5 * d.s, 1.4 * d.s, 1.3 * d.s, 0, 7); x.fillStyle = "rgba(220,212,196,.5)"; x.fill();
          x.restore();
        } else { // champignon luisant
          const gl = 0.5 + 0.5 * Math.sin(t * 2 + d.phase);
          this.glow(s.x, s.y - 2 * d.s, 14 * d.s, "90,200,150", 0.06 + gl * 0.05);
          x.fillStyle = "#6a5a44"; x.fillRect(s.x - 1 * d.s, s.y - 4 * d.s, 2 * d.s, 4 * d.s);
          x.fillStyle = "rgba(120,230,170," + (0.55 + gl * 0.35) + ")";
          x.beginPath(); x.ellipse(s.x, s.y - 4 * d.s, 3.2 * d.s, 2 * d.s, 0, 0, 7); x.fill();
        }
      }
    },
    /* ---- corbeaux ---- */
    drawCrows() {
      if (!this.crows) return;
      const x = this.ctx;
      for (const cr of this.crows) {
        if (!this.isOnScreen(cr.x, cr.y, 60)) continue;
        const s = this.worldToScreen(cr.x, cr.y - cr.alt);
        // ombre au sol (à l'altitude réelle)
        const g = this.worldToScreen(cr.x, cr.y);
        x.fillStyle = "rgba(0,0,0,.18)";
        x.beginPath(); x.ellipse(g.x, g.y, 5, 1.6, 0, 0, 7); x.fill();
        // silhouette en V battant des ailes
        const flap = Math.sin(cr.wing) * 5;
        x.strokeStyle = "#0c0c0e"; x.lineWidth = 2; x.lineCap = "round";
        x.beginPath();
        x.moveTo(s.x - 7 * cr.dir, s.y - flap);
        x.quadraticCurveTo(s.x, s.y + 2, s.x + 7 * cr.dir, s.y - flap);
        x.stroke();
      }
    },
    /* ---- surbrillance au survol ---- */
    drawHover() {
      const h = this.hover;
      if (!h) return;
      const x = this.ctx, s = this.worldToScreen(h.x, h.y), t = this._t;
      const pulse = 0.5 + 0.3 * Math.sin(t * 4);
      x.save(); x.globalCompositeOperation = "lighter";
      x.strokeStyle = "rgba(246,218,142," + pulse + ")"; x.lineWidth = 2;
      x.beginPath(); x.ellipse(s.x, s.y + 4, h.r, h.r * 0.42, 0, 0, 7); x.stroke();
      x.restore();
    },
    // traînée de poussière sous une entité en mouvement (procédural, sans état)
    dustTrail(px, py, dir) {
      const x = this.ctx, t = this._t;
      x.save(); x.globalCompositeOperation = "screen";
      for (let i = 0; i < 3; i++) {
        const p = ((t * 1.6 + i * 0.33) % 1);
        x.globalAlpha = (1 - p) * 0.22;
        x.fillStyle = "#9a8a6a";
        x.beginPath(); x.arc(px - dir * p * 10, py + 4 + Math.sin(i) * 1.5, 2 + p * 4, 0, 7); x.fill();
      }
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
        // liéré sombre (creusé)
        x.strokeStyle = "rgba(12,9,5,.5)"; x.lineWidth = 26;
        x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
        // terre battue
        x.strokeStyle = "rgba(74,58,38,.6)"; x.lineWidth = 18;
        x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
        // centre clair usé
        x.strokeStyle = "rgba(104,84,54,.5)"; x.lineWidth = 8;
        x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
        // ornières (2 traits pointillés)
        x.strokeStyle = "rgba(20,14,8,.4)"; x.lineWidth = 1.5; x.setLineDash([6, 9]);
        const nx = -(b.y - a.y), ny = (b.x - a.x), nl = Math.hypot(nx, ny) || 1;
        for (const off of [-4, 4]) {
          x.beginPath();
          x.moveTo(a.x + nx / nl * off, a.y + ny / nl * off);
          x.lineTo(b.x + nx / nl * off, b.y + ny / nl * off); x.stroke();
        }
        x.setLineDash([]);
      }
      x.restore();
    },

    drawScenery() {
      const x = this.ctx, t = this._t;
      for (const o of this.scenery) {
        if (!this.isOnScreen(o.x, o.y, 60)) continue;
        const s = this.worldToScreen(o.x, o.y);
        // léger balancement propre à chaque élément
        const sway = Math.sin(t * 1.1 + (o.seed & 255) * 0.1) * (o.type === "tree" ? 1.6 : 0.6);
        if (o.type === "tree") {
          if ((o.seed & 7) === 0) this.drawDeadTree(x, s.x, s.y, o.s, sway);
          else this.drawTree(x, s.x, s.y, o.s, sway);
        }
        else if (o.type === "bush") this.drawBush(x, s.x, s.y, o.s);
        else this.drawRock(x, s.x, s.y, o.s);
      }
    },
    drawTree(x, px, py, s, sway) {
      sway = sway || 0;
      // ombre portée allongée
      x.fillStyle = "rgba(0,0,0,.32)";
      x.beginPath(); x.ellipse(px + 6 * s, py + 3 * s, 14 * s, 4.5 * s, 0, 0, 7); x.fill();
      // tronc
      x.fillStyle = "#2c2012"; x.fillRect(px - 2.4 * s, py - 9 * s, 4.8 * s, 13 * s);
      x.fillStyle = "rgba(120,90,50,.35)"; x.fillRect(px - 2.4 * s, py - 9 * s, 1.6 * s, 13 * s);
      // canopée en 3 couches : ombre -> mid -> lumière
      const cx = px + sway, cy = py - 16 * s;
      const blobs = [
        { dx: -5, dy: 2, r: 11, c: "#16270f" }, { dx: 6, dy: 1, r: 10, c: "#16270f" }, { dx: 0, dy: -4, r: 12, c: "#1a2e12" },
        { dx: -4, dy: -1, r: 8, c: "#244017" }, { dx: 5, dy: -2, r: 7.5, c: "#244017" }, { dx: 0, dy: -6, r: 8.5, c: "#2c4d1d" },
      ];
      for (const b of blobs) { x.fillStyle = b.c; x.beginPath(); x.arc(cx + b.dx * s, cy + b.dy * s, b.r * s, 0, 7); x.fill(); }
      // points de lumière (highlight chaud, côté haut-gauche)
      x.fillStyle = "rgba(150,180,90,.45)";
      x.beginPath(); x.arc(cx - 4 * s, cy - 6 * s, 3 * s, 0, 7); x.arc(cx - 1 * s, cy - 3 * s, 2 * s, 0, 7); x.fill();
    },
    drawDeadTree(x, px, py, s, sway) {
      sway = sway || 0;
      x.fillStyle = "rgba(0,0,0,.3)";
      x.beginPath(); x.ellipse(px + 5 * s, py + 3 * s, 11 * s, 3.5 * s, 0, 0, 7); x.fill();
      x.strokeStyle = "#3a2c1e"; x.lineCap = "round"; x.lineWidth = 3.4 * s;
      x.beginPath(); x.moveTo(px, py + 4 * s); x.lineTo(px + sway * 0.4, py - 16 * s); x.stroke();
      // branches nues
      x.lineWidth = 1.8 * s;
      const br = [[-16, -10, -26, -20], [-14, -4, -22, -2], [-10, -18, -16, -28],
                 [14, -12, 24, -22], [12, -5, 22, -6], [9, -19, 15, -29]];
      for (const b of br) {
        x.beginPath();
        x.moveTo(px + b[0] * 0.5 * s + sway * 0.2, py + b[1] * s);
        x.lineTo(px + b[2] * 0.5 * s + sway * 0.5, py + b[3] * s); x.stroke();
      }
      // touche sanglante en pied (Champions of Avan)
      x.fillStyle = "rgba(90,18,14,.4)";
      x.beginPath(); x.ellipse(px + 2 * s, py + 4 * s, 6 * s, 2 * s, 0, 0, 7); x.fill();
    },
    drawBush(x, px, py, s) {
      x.fillStyle = "rgba(0,0,0,.28)";
      x.beginPath(); x.ellipse(px + 2 * s, py + 2 * s, 9 * s, 3 * s, 0, 0, 7); x.fill();
      x.fillStyle = "#1c3414";
      x.beginPath(); x.arc(px - 4 * s, py, 5 * s, 0, 7); x.arc(px + 4 * s, py, 5 * s, 0, 7); x.arc(px, py - 3 * s, 6 * s, 0, 7); x.fill();
      x.fillStyle = "rgba(120,150,70,.4)";
      x.beginPath(); x.arc(px - 2 * s, py - 3 * s, 2.4 * s, 0, 7); x.fill();
      // baies rouges occasionnelles
      x.fillStyle = "#8a2018";
      x.beginPath(); x.arc(px + 3 * s, py - 1 * s, 1.2 * s, 0, 7); x.arc(px - 3 * s, py + 1 * s, 1 * s, 0, 7); x.fill();
    },
    drawRock(x, px, py, s) {
      x.fillStyle = "rgba(0,0,0,.28)";
      x.beginPath(); x.ellipse(px + 2 * s, py + 2 * s, 10 * s, 3 * s, 0, 0, 7); x.fill();
      // masse
      const g = x.createLinearGradient(px, py - 8 * s, px, py + 5 * s);
      g.addColorStop(0, "#5a5d60"); g.addColorStop(1, "#34373a");
      x.fillStyle = g; x.strokeStyle = "#26282b"; x.lineWidth = 1.5;
      x.beginPath();
      x.moveTo(px - 9 * s, py + 3 * s); x.lineTo(px - 6 * s, py - 6 * s); x.lineTo(px + 2 * s, py - 8 * s);
      x.lineTo(px + 9 * s, py - 2 * s); x.lineTo(px + 7 * s, py + 4 * s); x.closePath(); x.fill(); x.stroke();
      // facette claire + mousse
      x.fillStyle = "rgba(200,200,205,.18)";
      x.beginPath(); x.moveTo(px - 6 * s, py - 6 * s); x.lineTo(px + 2 * s, py - 8 * s); x.lineTo(px - 2 * s, py - 2 * s); x.fill();
      x.fillStyle = "rgba(60,90,40,.4)";
      x.beginPath(); x.ellipse(px + 4 * s, py + 2 * s, 3 * s, 1.4 * s, 0, 0, 7); x.fill();
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
      this.glow(px, py - 18, 70, "255,158,64", 0.10 + glow * 0.05);
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
      this.glow(px - 15, py - 9, 38, "255,158,64", 0.12);
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
      // entrée (le trou) – encadré de bois si niveau >= 2
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
      this.glow(px, py - 2, 26, "255,180,90", 0.10);
      this.label(x, px, py + 24, b.name + " · Niv." + b.level);
    },

    /* ---- camps ennemis ---- */
    drawCamps() {
      for (const c of Game.state.camps) {
        if (!this.isOnScreen(c.pos.x, c.pos.y, 160)) continue;
        const s = this.worldToScreen(c.pos.x, c.pos.y);
        if (c.family === "betes") this.drawBeastCamp(this.ctx, s.x, s.y, c);
        else if (c.family === "morts-vivants") this.drawUndeadCamp(this.ctx, s.x, s.y, c);
        else this.drawGoblinCamp(this.ctx, s.x, s.y, c);
        if (c.isBoss) this.drawBossMarker(this.ctx, s.x, s.y - 46, c);
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
        this.glow(px, fy - 2, 52, "255,130,46", 0.18 + 0.06 * Math.sin(t * 12));
        x.fillStyle = "#3a2c1c"; x.fillRect(px - 5, fy, 10, 3);
        x.fillStyle = "#ff7a2a"; x.beginPath(); x.moveTo(px - 3, fy); x.quadraticCurveTo(px, fy - 8 - fl, px + 3, fy); x.fill();
        x.fillStyle = "#ffd24a"; x.beginPath(); x.moveTo(px - 1.5, fy); x.quadraticCurveTo(px, fy - 4 - fl, px + 1.5, fy); x.fill();
        // étincelles montantes
        x.fillStyle = "rgba(255,180,90,.8)";
        for (let k = 0; k < 3; k++) { const sp = (t * 1.5 + k * 0.4) % 1; x.globalAlpha = 1 - sp;
          x.beginPath(); x.arc(px + Math.sin((t + k) * 5) * 4, fy - sp * 22, 1, 0, 7); x.fill(); }
        x.globalAlpha = 1;
      }
      // bannière crâne
      x.strokeStyle = "#2a2018"; x.lineWidth = 1.5; x.beginPath(); x.moveTo(px + 24, py + 4); x.lineTo(px + 24, py - 18); x.stroke();
      x.fillStyle = "#6a1f1a"; x.fillRect(px + 24, py - 18, 12, 9);
      x.fillStyle = "#e8e0cf"; x.beginPath(); x.arc(px + 30, py - 14, 2.2, 0, 7); x.fill();
    },

    drawBeastCamp(x, px, py, c) {
      const t = this._t;
      this.shadow(x, px, py, 40, 14);
      // griffures au sol
      x.strokeStyle = "rgba(60,40,30,.5)"; x.lineWidth = 2;
      for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(px - 20 + i * 7, py + 14); x.lineTo(px - 10 + i * 7, py + 6); x.stroke(); }
      // monticule / tanière
      x.fillStyle = "#3a342c"; x.beginPath(); x.moveTo(px - 30, py + 8); x.quadraticCurveTo(px, py - 34, px + 30, py + 8); x.closePath(); x.fill();
      x.fillStyle = "#0a0a08"; x.beginPath(); x.ellipse(px, py + 2, 12, 10, 0, 0, 7); x.fill();
      // os plantés
      x.strokeStyle = "#d8d2c4"; x.lineWidth = 2;
      x.beginPath(); x.moveTo(px - 24, py + 9); x.lineTo(px - 28, py - 6); x.stroke();
      x.fillStyle = "#e8e0cf"; x.beginPath(); x.arc(px - 28, py - 7, 2, 0, 7); x.fill();
      // carcasse (côtes)
      x.strokeStyle = "#cfc8b8"; x.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) { x.beginPath(); x.arc(px + 17, py + 11, 4 + i * 2, Math.PI, Math.PI * 2); x.stroke(); }
      // yeux rouges dans la tanière
      if (!c.cleared) { const g = 0.5 + 0.5 * Math.sin(t * 4); x.fillStyle = "rgba(255,40,30," + (0.6 + g * 0.4) + ")";
        x.beginPath(); x.arc(px - 3, py + 2, 1.6, 0, 7); x.arc(px + 3, py + 2, 1.6, 0, 7); x.fill();
        this.glow(px, py + 2, 20, "255,40,24", 0.10 + g * 0.06); }
    },

    drawUndeadCamp(x, px, py, c) {
      const t = this._t;
      this.shadow(x, px, py, 40, 14);
      // brume verte
      x.save(); x.globalAlpha = 0.16 + 0.06 * Math.sin(t * 1.5); x.fillStyle = "#6fae5a";
      x.beginPath(); x.ellipse(px, py + 6, 34, 14, 0, 0, 7); x.fill(); x.restore();
      // arche de crypte
      x.fillStyle = "#5a5a54"; x.fillRect(px - 22, py - 20, 8, 28); x.fillRect(px + 14, py - 20, 8, 28);
      x.fillStyle = "#6a6a62"; x.fillRect(px - 24, py - 24, 48, 8);
      x.fillStyle = "#0a0c0a"; x.beginPath(); x.moveTo(px - 12, py + 8); x.lineTo(px - 12, py - 14);
      x.quadraticCurveTo(px, py - 22, px + 12, py - 14); x.lineTo(px + 12, py + 8); x.closePath(); x.fill();
      // pierres tombales
      x.fillStyle = "#4a4d50";
      for (const dx of [-30, 28]) {
        x.beginPath(); x.moveTo(px + dx - 5, py + 10); x.lineTo(px + dx - 5, py - 2);
        x.quadraticCurveTo(px + dx, py - 8, px + dx + 5, py - 2); x.lineTo(px + dx + 5, py + 10); x.closePath(); x.fill();
        x.strokeStyle = "#2c2e30"; x.lineWidth = 1; x.beginPath();
        x.moveTo(px + dx - 2, py + 1); x.lineTo(px + dx + 2, py + 1); x.moveTo(px + dx, py - 2); x.lineTo(px + dx, py + 5); x.stroke();
      }
      // crâne au sol
      x.fillStyle = "#e8e0cf"; x.beginPath(); x.arc(px - 16, py + 12, 3, 0, 7); x.fill();
      x.fillStyle = "#0a0c0a"; x.beginPath(); x.arc(px - 17, py + 12, 0.8, 0, 7); x.arc(px - 15, py + 12, 0.8, 0, 7); x.fill();
      // lueur verte dans la crypte
      if (!c.cleared) { const g = 0.5 + 0.5 * Math.sin(t * 3); x.fillStyle = "rgba(120,220,120," + (0.4 + g * 0.4) + ")";
        x.beginPath(); x.arc(px, py - 4, 2, 0, 7); x.fill();
        this.glow(px, py - 4, 30, "90,200,90", 0.10 + g * 0.06); }
    },

    drawBossMarker(x, px, py, c) {
      if (c.cleared) return;
      const t = this._t;
      // aura pulsée autour du camp
      const pulse = 0.35 + 0.3 * Math.sin(t * 3);
      x.strokeStyle = "rgba(216,69,58," + pulse + ")"; x.lineWidth = 2;
      x.beginPath(); x.ellipse(px, py + 50, 44, 18, 0, 0, 7); x.stroke();
      // couronne
      x.fillStyle = "#f4d488"; x.strokeStyle = "#7a5a1a"; x.lineWidth = 1;
      x.beginPath();
      x.moveTo(px - 9, py + 4); x.lineTo(px - 9, py - 3); x.lineTo(px - 4, py + 1);
      x.lineTo(px, py - 6); x.lineTo(px + 4, py + 1); x.lineTo(px + 9, py - 3); x.lineTo(px + 9, py + 4);
      x.closePath(); x.fill(); x.stroke();
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
        if (h._moving) this.dustTrail(s.x, s.y, 1);
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
      this.dustTrail(s.x, s.y + 4, 1);
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
      if (!this.drag.active) { this.updateHover(e.clientX, e.clientY); return; }
      const dx = e.clientX - this.drag.lastX, dy = e.clientY - this.drag.lastY;
      this.drag.lastX = e.clientX; this.drag.lastY = e.clientY;
      Game.state.camera.x -= dx; Game.state.camera.y -= dy;
      this.clampCamera();
      if (Math.hypot(e.clientX - this.drag.downX, e.clientY - this.drag.downY) > 6) this.drag.moved = true;
    },
    // détecte l'élément interactif sous le curseur pour le mettre en surbrillance
    updateHover(sx, sy) {
      if (!Game.state || Game.state.paused) { this.hover = null; return; }
      const w = this.screenToWorld(sx, sy);
      for (const h of Game.state.heroes) {
        if (h.state !== "idle") continue;
        if (Math.hypot(h.pos.x - w.x, h.pos.y - w.y) < 22) { this.hover = { x: h.pos.x, y: h.pos.y, r: 13 }; return; }
      }
      for (const c of Game.state.camps) {
        if (Math.hypot(c.pos.x - w.x, c.pos.y - w.y) < 42) { this.hover = { x: c.pos.x, y: c.pos.y, r: 34 }; return; }
      }
      for (const k in Game.state.buildings) {
        const b = Game.state.buildings[k];
        if (Math.hypot(b.pos.x - w.x, b.pos.y - w.y) < 46) { this.hover = { x: b.pos.x, y: b.pos.y, r: 38 }; return; }
      }
      this.hover = null;
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
