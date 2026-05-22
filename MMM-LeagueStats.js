/* global Module Log Zepto */

Module.register("MMM-LeagueStats", {
  name: "MMM-LeagueStats",
  logPrefix: "MMM-LeagueStats ::",
  template: null,
  defaults: {
    broker: "192.168.0.2",
    port: 1883
    // riotMonitorUrl is REQUIRED — the riot-monitor base URL that serves
    // champion tiles and item icons. It has no default: the module refuses
    // to start without it (see start() / getDom()).
  },
  wrapper: null,
  disabled: false,
  _cache: { players: null },
  // URLs of images already fetched — lets us swap background-image without a
  // flash/refetch (the champion tile never changes mid-game; items rarely do).
  _imgCache: null,

  start() {
    this.info("Starting");
    this.config = { ...this.defaults, ...this.config };

    // riotMonitorUrl is mandatory — without it the module cannot resolve any
    // asset. Refuse to start and surface a warning instead of a broken UI.
    if (
      typeof this.config.riotMonitorUrl !== "string" ||
      !this.config.riotMonitorUrl.trim()
    ) {
      this.disabled = true;
      this.error("'riotMonitorUrl' is required — module disabled");
      return;
    }

    this._imgCache = new Set();
    this.wrapper = Zepto("<div />", { class: "wrapper is-hidden" });
    this._loadTemplate().then(() => {
      this.info("Started");
      this.insertComponents();
    });
    setInterval(() => this._sendNotification("SET_CONFIG", this.config), 1000);
  },

  // riot-monitor base URL — guaranteed present (start() bails without it).
  _assetBase() {
    return this.config.riotMonitorUrl.trim().replace(/\/+$/, "");
  },

  // Set an element's background-image without flicker: skip if unchanged,
  // otherwise preload the image and only swap once it is decoded.
  _setBg(el, url) {
    if (el.data("bg") === url) return;
    const apply = () => {
      el.css("background-image", `url(${url})`);
      el.data("bg", url);
    };
    if (this._imgCache.has(url)) {
      apply();
      return;
    }
    const img = new Image();
    img.onload = () => {
      this._imgCache.add(url);
      apply();
    };
    img.src = url;
  },

  _clearBg(el) {
    if (el.data("bg") === null || el.data("bg") === undefined) return;
    el.removeAttr("style");
    el.data("bg", null);
  },

  _hasChanged(o, n) {
    return (
      typeof o === "undefined" ||
      o === null ||
      !o ||
      typeof n === "undefined" ||
      n === null ||
      !n ||
      typeof DeepDiff(o, n) !== "undefined"
    );
  },

  // Render the in-game player grid. Players arrive grouped by team; the
  // template exposes a .player.order / .player.chaos slot per row.
  _updatePlayers() {
    const { players: allPlayers } = this._cache;
    if (allPlayers && Object.keys(allPlayers).length > 0) {
      const base = this._assetBase();
      // Show one row per filled slot (5v5 normal, 6v6 Hexakill), hide the rest.
      const teamSize = Math.max(
        0,
        ...Object.values(allPlayers).map((p) => p.length)
      );
      for (let r = 0; r < 6; r++) {
        const row = this.wrapper.find(`.in-game-stats .row-${r}`);
        if (r < teamSize) row.removeClass("is-hidden");
        else row.addClass("is-hidden");
      }
      Object.entries(allPlayers).forEach(([team, players]) => {
        const teamClass = team.trim().toLowerCase();
        players.forEach((player, i) => {
          const playerRow = this.wrapper.find(
            `.in-game-stats .row-${i} .player.${teamClass}`
          );

          this._setBg(
            playerRow.find(".champion-avatar"),
            `${base}/assets/champion/${player.championAlias}/splash/${player.skinNum}`
          );

          if (player.isDead) playerRow.addClass("is-dead");
          else playerRow.removeClass("is-dead");

          Object.entries(player.scores).forEach(([k, score]) => {
            playerRow.find("." + k + " .v").text(score.toFixed(0));
          });

          playerRow.find(".champion-name").text(player.championName);

          for (let s = 0; s < 6; s++) {
            const item = player.items.find((it) => it.slot === s);
            const slot = playerRow.find(".slot.item-" + s);
            if (item) {
              this._setBg(slot, `${base}/assets/item/${item.itemID}`);
            } else {
              this._clearBg(slot);
            }
          }
        });
      });
      this.wrapper.find(".game-stats-card").removeClass("is-hidden");
    } else {
      this.wrapper.find(".game-stats-card").addClass("is-hidden");
      const grid = this.wrapper.find(".in-game-stats");
      grid.find(".is-dead").removeClass("is-dead");
      grid.find(".champion-name").text("");
      ["kills", "deaths", "assists"].forEach((k) => {
        grid.find("." + k + " .v").text("");
      });
      // Also drop the cached bg marker so a new match re-applies the image.
      grid.find(".slot").removeAttr("style").data("bg", null);
      grid.find(".champion-avatar").removeAttr("style").data("bg", null);
    }
  },

  _resetUi() {
    this._cache = { players: null };
    this._updatePlayers();
  },

  _update(payload) {
    Object.entries(payload).forEach(([type, data]) => {
      if (type !== "players") return;
      if (this._hasChanged(this._cache[type], data)) {
        this._cache[type] = data ?? null;
        this._updatePlayers();
      }
    });
  },

  // Logging wrapper
  log(...args) {
    Log.log(this.logPrefix, ...args);
  },
  info(...args) {
    Log.info(this.logPrefix, ...args);
  },
  debug(...args) {
    Log.debug(this.logPrefix, ...args);
  },
  error(...args) {
    Log.error(this.logPrefix, ...args);
  },
  warning(...args) {
    Log.warn(this.logPrefix, ...args);
  },

  _loadTemplate() {
    return new Promise((resolve) => {
      const lT = () => {
        this.nunjucksEnvironment().render(
          `templates/template.njk`,
          {},
          (err, res) => {
            if (err) {
              this.error(`Failed to load template`, err);
              setTimeout(() => lT(), 1000);
            } else {
              this.template = res;
              resolve();
            }
          }
        );
      };
      lT();
    });
  },

  insertComponents() {
    Zepto(this.template).appendTo(this.wrapper);
  },

  getScripts() {
    return [
      this.file("node_modules/zepto/dist/zepto.min.js"),
      this.file("node_modules/deep-diff/dist/deep-diff.min.js")
    ];
  },

  getStyles() {
    return [`${this.name}.css`];
  },

  getTranslations() {
    return {
      en: "translations/en.json",
      es: "translations/es.json"
    };
  },

  getHeader: () => null,

  getDom() {
    if (this.disabled) {
      const warn = document.createElement("div");
      warn.className = "MMM-LeagueStats-warning";
      warn.textContent = this.translate("MISSING_RIOT_MONITOR_URL");
      warn.style.padding = "1rem";
      warn.style.color = "#ffb74d";
      warn.style.fontWeight = "700";
      return warn;
    }
    return this.wrapper.get(0);
  },

  _sendNotification(notification, payload) {
    this.sendSocketNotification(`${this.name}-${notification}`, payload);
  },

  _notificationReceived(notification, payload) {
    switch (notification) {
      case "READY":
        if (!payload || !payload.ready) {
          this.wrapper.addClass("is-hidden");
          this._resetUi();
          break;
        }
        this.wrapper.removeClass("is-hidden");
        break;
      case "UPDATE":
        this._update(payload ?? {});
        break;
      default:
    }
  },

  socketNotificationReceived(notification, payload) {
    this._notificationReceived(
      notification.replace(new RegExp(`${this.name}-`, "gi"), ""),
      payload
    );
  }
});
