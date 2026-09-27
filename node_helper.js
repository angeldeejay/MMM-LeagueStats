const NodeHelper = require("node_helper");
const Log = require("logger");
const path = require("path");
const mqtt = require("mqtt");
const DeepDiff = require("deep-diff");

// riot-exposer publishes retained MQTT topics wrapped by NestJS as
// { pattern, data }: the whole LCU client state, and the game client's
// region/locale (LolL10nRegionLocale).
const STATE_TOPIC = "data.state.updated";
const CLIENT_INFO_TOPIC = "client.info.updated";

// DDragon — only used to resolve championId -> alias/name for display and for
// the riot-monitor asset URLs. One lazy fetch per process, no daemon.
const DDRAGON = "https://ddragon.leagueoflegends.com";

// The module only does work while a live match is running.
const IN_GAME_PHASES = ["GameStart", "InProgress", "Reconnect"];

module.exports = NodeHelper.create({
  name: path.basename(__dirname),
  logPrefix: `${path.basename(__dirname)} ::`,

  client: null,
  config: null,

  ready: false,
  _cache: null,

  // championId -> { alias, name } — lazy, in-memory, fetched once per locale.
  _champions: null,
  _ddragonLoading: null,
  _ddVersion: null,
  // alias -> { skinNum: skinName } — fetched per champion on demand, cached.
  _championDetail: {},
  _detailLoading: {},
  // DDragon locale — synced to the game client via CLIENT_INFO_TOPIC.
  _locale: "en_US",
  _lastState: null,

  start() {
    this.log("Starting");
    this._cache = { players: null };
    // Heartbeat: re-sync a freshly (re)loaded front mirror.
    setInterval(() => {
      this._sendNotification("READY", { ready: this.ready });
      if (this.ready) this._sendNotification("UPDATE", this._cache);
    }, 1000);
    this.log("Started");
  },

  // ── DDragon (lazy champion lookup) ────────────────────────────────────────

  _loadDDragon() {
    if (this._champions) return Promise.resolve();
    if (this._ddragonLoading) return this._ddragonLoading;

    this._ddragonLoading = (async () => {
      const versions = await fetch(`${DDRAGON}/api/versions.json`).then((r) =>
        r.json()
      );
      this._ddVersion = versions[0];
      const champ = await fetch(
        `${DDRAGON}/cdn/${this._ddVersion}/data/${this._locale}/champion.json`
      ).then((r) => r.json());
      const map = {};
      for (const c of Object.values(champ.data)) {
        map[parseInt(c.key, 10)] = { alias: c.id, name: c.name };
      }
      this._champions = map;
      this.log(`DDragon loaded — ${Object.keys(map).length} champions`);
    })().catch((err) => {
      this.error("DDragon load failed", err);
      this._ddragonLoading = null; // allow a retry on the next payload
      throw err;
    });

    return this._ddragonLoading;
  },

  // Game-mode variants (e.g. Jade_Blitzcrank, 60053) carry 60000 + the base
  // champion id and the base champion's name. DDragon lists only base
  // champions, so a variant falls back to its base id (id % 1000).
  _champ(id) {
    const map = this._champions || {};
    return map[id] || map[id % 1000] || { alias: "None", name: "—" };
  },

  // Per-champion skin names — DDragon detail file, fetched once per alias.
  _loadDetail(alias) {
    if (alias === "None" || this._championDetail[alias])
      return Promise.resolve();
    if (this._detailLoading[alias]) return this._detailLoading[alias];

    this._detailLoading[alias] = (async () => {
      const doc = await fetch(
        `${DDRAGON}/cdn/${this._ddVersion}/data/${this._locale}/champion/${alias}.json`
      ).then((r) => r.json());
      const champ = doc.data && doc.data[alias];
      const skins = {};
      if (champ && Array.isArray(champ.skins)) {
        for (const sk of champ.skins) skins[sk.num] = sk.name;
      }
      this._championDetail[alias] = skins;
    })().catch((err) => {
      this.error(`DDragon detail ${alias} failed`, err);
      delete this._detailLoading[alias];
      throw err;
    });

    return this._detailLoading[alias];
  },

  // Resolve a skin id to its display name — the skin name, or the champion
  // name for the base skin (DDragon names skin 0 "default"). The trailing
  // chroma suffix — e.g. "Worldbreaker Sion (Obsidian)" — is stripped.
  _skinLabel(alias, championName, skinNum) {
    const name = (this._championDetail[alias] || {})[skinNum];
    if (!name || name.toLowerCase() === "default") return championName;
    return name.replace(/\s*\([^)]*\)\s*$/, "").trim() || championName;
  },

  // ── MQTT ──────────────────────────────────────────────────────────────────

  connectToBroker() {
    const url = `mqtt://${this.config.broker}:${this.config.port}`;
    if (this.client !== null) {
      try {
        this.client.end(true);
      } catch (_) {}
      this.client = null;
    }

    this.log(`Connecting to ${url}`);
    this.client = mqtt.connect(url, {
      clean: true,
      connectTimeout: 4000,
      reconnectPeriod: 2000
    });

    this.client.on("connect", () => {
      this.debug("mqtt-connect");
      this.client.subscribe([STATE_TOPIC, CLIENT_INFO_TOPIC]);
    });
    ["error", "reconnect", "offline", "close", "end"].forEach((ev) =>
      this.client.on(ev, () => this.debug(`mqtt-${ev}`))
    );
    this.client.on("message", (topic, message) =>
      this._onMessage(topic, message)
    );
  },

  _onMessage(topic, message) {
    let envelope;
    try {
      envelope = JSON.parse(message.toString());
    } catch (_) {
      return;
    }
    // NestJS MQTT transport wraps payloads as { pattern, data }.
    const data =
      envelope && typeof envelope === "object" && "data" in envelope
        ? envelope.data
        : envelope;
    if (!data || typeof data !== "object") return;
    if (topic === STATE_TOPIC) this._handleState(data);
    else if (topic === CLIENT_INFO_TOPIC) this._onClientInfo(data);
  },

  // Game-client region/locale from riot-exposer. On locale change, drop every
  // DDragon cache so names re-resolve in the client's language, then replay
  // the last known state so an in-progress match refreshes immediately.
  _onClientInfo(info) {
    const locale = typeof info.locale === "string" ? info.locale.trim() : "";
    if (!locale || locale === this._locale) return;
    this.log(`Client locale: ${locale}`);
    this._locale = locale;
    this._champions = null;
    this._ddragonLoading = null;
    this._championDetail = {};
    this._detailLoading = {};
    if (this._lastState) this._handleState(this._lastState);
  },

  async _handleState(d) {
    this._lastState = d;
    // TFT matches expose no live player data, so the overlay stays hidden for
    // them. riot-exposer already masks TFT upstream (phase None / mode NONE);
    // this is defense in depth in case a raw mode slips through.
    const isTft = `${d.mode || ""}`.toUpperCase().includes("TFT");
    const inGame =
      d.connected === true && !isTft && IN_GAME_PHASES.includes(d.phase);

    if (!inGame) {
      if (this.ready) this.log("Match ended — going idle");
      this.ready = false;
      this._cache = { players: null };
      this._sendNotification("READY", { ready: false });
      return;
    }

    try {
      await this._loadDDragon();
    } catch (_) {
      return; // cannot resolve champions yet; retry on next payload
    }

    // Prefetch skin names for every champion in the match (cached per alias).
    const aliases = [
      ...new Set((d.players || []).map((p) => this._champ(p.championId).alias))
    ];
    await Promise.allSettled(aliases.map((a) => this._loadDetail(a)));

    this._cache = { players: this._mapPlayers(d.players || []) };
    this.ready = true;
    this._sendNotification("READY", { ready: true });
    this._sendNotification("UPDATE", this._cache);
  },

  // ── transform: LCUClientData.players -> front grid shape ──────────────────
  // Players are grouped by team (template classes order/chaos). Raw data only
  // — the front builds the riot-monitor asset URLs and owns image caching.
  // Fields absent from the LCU payload (creep/ward score, respawn timer)
  // degrade to neutral values.

  _mapPlayers(players) {
    const teams = {};
    for (const p of players) {
      const team = (p.team || "UNKNOWN").toString();
      const champ = this._champ(p.championId);
      const skinNum = (p.skinId || 0) % 1000;
      const s = p.scores || {};
      (teams[team] = teams[team] || []).push({
        championAlias: champ.alias,
        // riot-monitor shows the skin name as the player's label.
        championName: this._skinLabel(champ.alias, champ.name, skinNum),
        skinNum,
        isDead: p.dead === true,
        scores: {
          kills: s.kills || 0,
          deaths: s.deaths || 0,
          assists: s.assists || 0
        },
        items: (p.items || []).map((it) => ({
          slot: it.slot,
          itemID: it.itemID
        }))
      });
    }
    return teams;
  },

  // ── notifications ─────────────────────────────────────────────────────────

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

  _sendNotification(notification, payload) {
    this.sendSocketNotification(`${this.name}-${notification}`, payload);
  },

  _notificationReceived(notification, payload) {
    switch (notification) {
      case "SET_CONFIG":
        if (
          typeof payload === "object" &&
          this._hasChanged(this.config, payload)
        ) {
          this.debug("config-set");
          this.config = payload;
          this.connectToBroker();
        }
        break;
      default:
    }
  },

  socketNotificationReceived(notification, payload) {
    this._notificationReceived(
      notification.replace(new RegExp(`${this.name}-`, "gi"), ""),
      payload
    );
  },

  // ── logging ───────────────────────────────────────────────────────────────

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
  }
});
