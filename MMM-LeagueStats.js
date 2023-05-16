/* global Module Log */

Module.register("MMM-LeagueStats", {
  name: "MMM-LeagueStats",
  logPrefix: "MMM-LeagueStats ::",
  template: null,
  defaults: {
    broker: "127.0.0.1",
    port: 1883
  },
  wrapper: null,
  $: null,
  version: null,
  _cache: {
    summoner: null,
    events: null,
    players: null,
    history: null,
    stats: null,
    currentGame: null,
    currentChampion: null
  },

  start() {
    this.info(`Starting`);
    this.config = {
      ...this.defaults,
      ...this.config
    };
    // this.wrapper = this.$("<div />", { class: "wrapper is-hidden" });
    this.wrapper = $("<div />", { class: "wrapper is-hidden" });
    this.debug("Loading template");
    this._loadTemplate().then(() => {
      this.info("Started");
      this.insertComponents();
    });

    setInterval(() => this._sendNotification("SET_CONFIG", this.config), 1000);
  },

  _now: () => new Date().getTime(),

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

  _updateSummoner() {
    const { summoner } = this._cache;
    if (summoner) {
      if (summoner.profileIcon) {
        this.wrapper
          .find(".summoner-icon")
          .css(
            "background-image",
            `url(/${this.name}/cdn/${this.version}/img/profileicon/${summoner.profileIcon}.png)`
          );
      }
      if (summoner.xpProgress && summoner.xpProgress)
        this.wrapper
          .find(".summoner-level")
          .attr("value", summoner.xpProgress.toFixed(0));

      if (summoner.summonerLevel && summoner.summonerLevel)
        this.wrapper
          .find(".summoner-stats-card .value.level")
          .text(summoner.summonerLevel);

      if (summoner.name && summoner.name)
        this.wrapper.find(".username").text(summoner.name);

      this.wrapper.attr(
        "class",
        this.wrapper.hasClass("is-hidden") ? "wrapper is-hidden" : "wrapper"
      );
      if (summoner.gameStatus && summoner.gameStatus) {
        this.wrapper.addClass(
          summoner.gameStatus.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())
        );
        if (["inGame", "spectating"].includes(summoner.gameStatus)) {
          this._cache.players = {};
          this._updatePlayers();
        }

        this.wrapper
          .find(".game-status")
          .text(summoner.gameStatusLabel)
          .parent()
          .removeClass("is-hidden");
      } else {
        this.wrapper.find(".game-status").parent().addClass("is-hidden");
      }
      this.wrapper.find(".summoner-profile-card").removeClass("is-hidden");
    } else {
      this.wrapper.attr(
        "class",
        this.wrapper.hasClass("is-hidden") ? "wrapper is-hidden" : "wrapper"
      );
      this.wrapper.find(".summoner-level").attr("value", "0");
      this.wrapper.find(".summoner-icon").removeAttr("style");
      this.wrapper.find(".username").text("");
      this.wrapper.find(".game-status").text("");
      this.wrapper.find(".banner-level .center").text("");
      this.wrapper.find(".summoner-profile-card").addClass("is-hidden");
    }
  },

  _updateEvents() {},

  _updatePlayers() {
    const { players: allPlayers } = this._cache;
    if (allPlayers && Object.keys(allPlayers).length > 0) {
      Object.entries(allPlayers).forEach(([team, players]) => {
        const teamClass = team.trim().toLowerCase();
        players.forEach((player, i) => {
          const playerRow = this.wrapper.find(
            `.in-game-stats .row-${i} .player.${teamClass}`
          );

          playerRow.find(".respawn-timer").text(player.respawnTimer);
          playerRow
            .find(".champion-avatar")
            .attr(
              "src",
              `/${this.name}/cdn/img/champion/tiles/` +
                player.championAlias +
                "_" +
                player.skin +
                ".jpg"
            );
          if (player.isDead) {
            playerRow.addClass("is-dead");
          } else {
            playerRow.removeClass("is-dead");
          }

          Object.entries(player.scores).forEach(([k, score]) => {
            playerRow.find("." + k).text(score.toFixed(0));
          });

          playerRow
            .find(".player-champion")
            .text(
              player.skinName === "default"
                ? player.championName
                : player.skinName
            );

          for (let i = 0; i < 6; i++) {
            const item = player.items.find((item) => item.slot === i);
            const slot = playerRow.find(".slot.item-" + i);
            if (item) {
              slot.css(
                "background-image",
                `url(/${this.name}/cdn/${this.version}/img/item/${item.itemID}.png)`
              );
            } else {
              slot.removeAttr("style");
            }
          }
        });
      });
    } else {
      const gameStatsWrapper = this.wrapper.find(".in-game-stats");
      gameStatsWrapper.find(".is-dead").removeClass("is-dead");
      gameStatsWrapper.find(".player-champion").text("");
      ["kills", "deaths", "assists", "creepScore", "wardScore"].forEach((k) => {
        gameStatsWrapper.find("." + k).text("");
      });
      gameStatsWrapper.find(".slot").removeAttr("style");
    }
  },

  _appendHistoryItem(game) {
    const historyList = this.wrapper.find(".recent-matches > .history-list");
    const item = $("<li>")
      .addClass("is-inline-block my-0 p-0 game-" + game.gameId)
      .addClass(game.win ? "won" : "lost")
      .data("gameId", game.gameId);
    $("<img>", {
      src: `/${this.name}/cdn/img/champion/tiles/${game.champion.alias}_${game.champion.currentSkin.num}.jpg`
    })
      .addClass("is-block")
      .appendTo(item);

    item.prependTo(historyList);
  },

  _updateHistory() {
    const { history: allHistory } = this._cache;
    const historyList = this.wrapper.find(".recent-matches > .history-list");
    const maxLength = 10;
    if (Array.isArray(allHistory) && allHistory.length > 0) {
      const history = allHistory
        .slice(0, maxLength)
        .sort((a, b) =>
          a.gameId > b.gameId ? 1 : b.gameId > a.gameId ? -1 : 0
        );
      const receivedHistoryIds = history.map(function (g) {
        return g.gameId;
      });
      const currentHistoryIds = [];
      const toDelete = [];
      const toAdd = [];
      historyList.find("> li").each(function (_, li) {
        const item = $(li),
          gameId = item.data("gameId");
        if (receivedHistoryIds.includes(gameId)) {
          currentHistoryIds.push(gameId);
        } else {
          toDelete.push(item);
        }
        currentHistoryIds.push($(li).data("gameId"));
      });
      history.forEach(function (game) {
        if (currentHistoryIds.includes(game.gameId)) return;
        toAdd.push(game);
      });

      if (Math.max(toAdd.length, toDelete.length) === 0) return;

      for (let i = 0; i < Math.max(toAdd.length, toDelete.length); i++) {
        if (i < toAdd.length) this._appendHistoryItem(toAdd[i]);
        if (i < toDelete.length) toDelete[i].remove();
      }
    } else {
      historyList.children().remove();
    }
  },

  _updateStats() {
    const { stats } = this._cache;
    if (stats) {
      if (stats.matches)
        this.wrapper
          .find(".summoner-stats-card .value.matches")
          .text(stats.matches + "");
      if (stats.winRatio)
        this.wrapper
          .find(".summoner-stats-card .value.win-ratio")
          .text(stats.winRatio + "%");
      if (stats.kda)
        this.wrapper
          .find(".summoner-stats-card .title.kda span:last-child")
          .text(stats.kda + "");
      if (stats.kills && stats.deaths && stats.assists)
        this.wrapper
          .find(".summoner-stats-card .value.kda")
          .text(stats.kills + " / " + stats.deaths + " / " + stats.assists);
    }
  },

  _updateCurrentGame() {
    const { currentGame } = this._cache;
    if (currentGame) {
      if (currentGame.buddies) {
        this.wrapper
          .find(".bottom .buddies")
          .removeClass("is-hidden")
          .text(currentGame.buddies);
      } else {
        this.wrapper.find(".bottom .buddies").addClass("is-hidden").text("");
      }
      if (currentGame.map) {
        this.wrapper
          .find(".bottom .current-map")
          .removeClass("is-hidden")
          .text(currentGame.map);
      } else {
        this.wrapper
          .find(".bottom .current-map")
          .addClass("is-hidden")
          .text("");
      }
      const parts = [
        currentGame.mode ?? undefined,
        currentGame.gameQueueTypeLabel ?? undefined
      ].filter(function (l) {
        return typeof l === "string";
      });
      if (parts.length > 0) {
        this.wrapper
          .find(".bottom .current-mode")
          .removeClass("is-hidden")
          .text(parts.join(", "));
      } else {
        this.wrapper
          .find(".bottom .current-mode")
          .addClass("is-hidden")
          .text("");
      }
    } else {
      this.wrapper.find(".bottom .current-map").addClass("is-hidden").text("");
      this.wrapper.find(".bottom .current-mode").addClass("is-hidden").text("");
      this.wrapper.find(".bottom .buddies").addClass("is-hidden").text("");
    }
  },

  _updateCurrentChampion() {
    const { currentChampion } = this._cache;
    if (currentChampion) {
      if (currentChampion.currentSkin) {
        this.wrapper
          .find(".current-champion")
          .removeClass("is-hidden")
          .text(
            currentChampion.currentSkin.name === "default"
              ? currentChampion.alias
              : currentChampion.currentSkin.name
          );
      } else {
        this.wrapper.find(".current-champion").addClass("is-hidden").text("");
      }
    } else {
      this.wrapper.find(".current-champion").addClass("is-hidden").text("");
    }
  },

  _resetUi() {
    this._cache = {
      summoner: null,
      events: null,
      players: null,
      history: null,
      stats: null,
      currentGame: null,
      currentChampion: null
    };
    this._updateUi();
  },

  _updateUi() {
    this._updateSummoner();
    this._updateEvents();
    this._updatePlayers();
    this._updateHistory();
    this._updateStats();
    this._updateCurrentGame();
    this._updateCurrentChampion();
  },

  _update(payload) {
    Object.entries(payload).forEach(([type, data]) => {
      if (this._hasChanged(this._cache[type], data)) {
        const updater = `_update${type[0].toUpperCase()}${type.slice(1)}`;
        this._cache[type] = data ?? null;
        this[updater]();
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
    return new Promise((resolve, reject) => {
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
    $(this.template).appendTo(this.wrapper);
  },

  getScripts() {
    return [
      "moment.js",
      this.file("node_modules/jquery/dist/jquery.min.js"),
      this.file("node_modules/mqtt/dist/mqtt.min.js"),
      this.file("node_modules/deep-diff/dist/deep-diff.min.js")
    ];
  },

  // Load stylesheets
  getStyles() {
    return [`${this.name}.css`];
  },

  getHeader: () => null,

  getDom() {
    return this.wrapper.get(0);
  },

  _sendNotification(notification, payload) {
    this.sendSocketNotification(`${this.name}-${notification}`, payload);
  },

  _notificationReceived(notification, payload) {
    switch (notification) {
      case "READY":
        if (!payload.version || !payload.ready) {
          this.wrapper.addClass("is-hidden");
          this._resetUi();
          break;
        }
        this.wrapper.removeClass("is-hidden");
        this.version = payload.version;
        break;
      case "UPDATE":
        if (!this.version) break;
        const data = payload ?? {};
        if (!data) return;
        this._update(data);
        break;
      default:
    }
  },

  // Socket Notification Received
  socketNotificationReceived: function (notification, payload) {
    this._notificationReceived(
      notification.replace(new RegExp(`${this.name}-`, "gi"), ""),
      payload
    );
  }
});
