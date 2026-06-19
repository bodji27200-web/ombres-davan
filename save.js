/* =================================================================
   save.js — Sauvegarde LocalStorage + autosave + hors-ligne
   ================================================================= */
(function (Game) {
  "use strict";

  const KEY = "ombres_avan_save_v1";

  function mapObj(o, f) { const r = {}; for (const k in o) r[k] = f(o[k]); return r; }

  const Save = {
    KEY,
    OFFLINE_CAP: 2 * 3600,     // 2 h de gains hors-ligne maximum

    has() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } },

    // Sérialise l'état courant (les classes exposent toJSON()).
    save() {
      const st = Game.state;
      if (!st) return false;
      try {
        const data = {
          v: 1,
          savedAt: Date.now(),
          difficulty: st.difficulty,
          worldSeed: st.worldSeed,
          resources: { gold: st.resources.gold, wood: st.resources.wood, stone: st.resources.stone },
          camera: { x: st.camera.x, y: st.camera.y },
          buildings: mapObj(st.buildings, b => b.toJSON()),
          chariots: st.chariots.map(c => c.toJSON()),
          heroes: st.heroes.map(h => h.toJSON()),
          camps: st.camps.map(c => ({
            id: c.id, level: c.level, cleared: c.cleared,
            fortifyTimer: c.fortifyTimer || 0, respawnTimer: c.respawnTimer || 0,
          })),
          victoryChest: st.victoryChest || null,
        };
        localStorage.setItem(KEY, JSON.stringify(data));
        st.lastSaved = data.savedAt;
        return true;
      } catch (e) {
        console.warn("[save] échec :", e);
        return false;
      }
    },

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.warn("[load] échec :", e);
        return null;
      }
    },

    clear() { try { localStorage.removeItem(KEY); } catch (e) {} },

    // Calcule les gains hors-ligne (plafonnés) à partir d'une sauvegarde.
    // Renvoie { seconds, wood, stone } — la production cumulée pendant l'absence.
    offlineGains(data) {
      const now = Date.now();
      const elapsed = Math.max(0, (now - (data.savedAt || now)) / 1000);
      const seconds = Math.min(elapsed, this.OFFLINE_CAP);
      const out = { seconds, wood: 0, stone: 0 };
      if (seconds < 5 || !data.buildings) return out;
      const prodMult = (Game.DIFFS[data.difficulty] || {}).prodMult || 1;
      for (const k in data.buildings) {
        const bd = data.buildings[k];
        const def = Game.Entities.BUILDING_DEFS[bd.key];
        if (!def || !def.produces) continue;
        const rate = def.baseProd * (1 + (bd.level - 1) * 0.5) * prodMult;
        const amount = Math.floor(rate * seconds);
        if (def.produces === "wood") out.wood += amount;
        else if (def.produces === "stone") out.stone += amount;
      }
      return out;
    },

    autosaveStart(intervalMs) {
      this.stop();
      this._iv = setInterval(() => this.save(), intervalMs || 10000);
      this._onUnload = () => this.save();
      this._onVis = () => { if (document.hidden) this.save(); };
      window.addEventListener("beforeunload", this._onUnload);
      document.addEventListener("visibilitychange", this._onVis);
    },
    stop() {
      if (this._iv) { clearInterval(this._iv); this._iv = null; }
      if (this._onUnload) window.removeEventListener("beforeunload", this._onUnload);
      if (this._onVis) document.removeEventListener("visibilitychange", this._onVis);
    },
  };

  Game.Save = Save;
})(window.Game = window.Game || {});
