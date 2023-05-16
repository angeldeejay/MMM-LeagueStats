const NodeHelper = require("node_helper");
const Log = require("logger");
const path = require("path");
const mqtt = require("mqtt");
const DeepDiff = require("deep-diff");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { networkInterfaces } = require("os");

const nets = networkInterfaces();
const results = Object.create(null); // Or just '{}', an empty object

for (const name of Object.keys(nets)) {
  for (const net of nets[name]) {
    // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
    // 'IPv4' is in Node <= 17, from 18 it's a number 4 or 6
    const familyV4Value = typeof net.family === "string" ? "IPv4" : 4;
    if (net.family === familyV4Value && !net.internal) {
      if (!results[name]) {
        results[name] = [];
      }
      results[name].push(net.address);
    }
  }
}
console.log(results);

module.exports = NodeHelper.create({
  name: path.basename(__dirname),
  logPrefix: `${path.basename(__dirname)} ::`,
  _cache: {
    summoner: null,
    events: null,
    players: null,
    history: null,
    stats: null,
    currentGame: null,
    currentChampion: null
  },
  client: null,
  ready: false,
  connected: false,
  version: null,
  lastTs: 0,

  start() {
    this.log("Starting");

    // Inactivity
    setInterval(() => {
      if (this._now() - this.lastTs > 750 && this.ready === true) {
        this.ready = false;
      }
      this._sendNotification("READY", {
        ready: this.ready,
        version: this.version
      });
    }, 100);

    setInterval(() => {
      if (this.ready) {
        this._sendNotification("UPDATE", this._cache);
      } else {
        this.version = null;
        this._cache = {
          summoner: null,
          events: null,
          players: null,
          history: null,
          stats: null,
          currentGame: null,
          currentChampion: null
        };
      }
    }, 100);

    this.setProxy();
    this.log("Started");
  },

  _now: () => new Date().getTime(),

  connectToBroker() {
    const url = `mqtt://${this.config.broker}:${this.config.port}`;
    const options = {
      clean: true,
      connectTimeout: 4000
    };

    if (this.client !== null) {
      try {
        this.client.end();
      } catch (_) {}
      delete this.client;
      this.client = null;
    }

    this.client = mqtt.connect(url, options);
    this.client.on("connect", () => {
      this.debug("mqtt-connect");
      this.connected = true;
      // Subscribe to a topic
      this.client.subscribe("lcu/+");
      this.client.subscribe("lcu/live/+");
    });

    this.client.on("error", (..._) => {
      this.connected = false;
      this.debug("mqtt-error");
    });
    this.client.on("reconnect", () => {
      this.connected = false;
      this.debug("mqtt-reconnect");
    });
    this.client.on("offline", () => {
      this.connected = false;
      this.debug("mqtt-offline");
    });
    this.client.on("end", () => {
      this.connected = false;
      this.debug("mqtt-end");
    });
    this.client.on("close", () => {
      this.connected = false;
      this.debug("mqtt-close");
    });

    // Receive messages
    this.client.on("message", (topic, message) => {
      let data;
      try {
        data = JSON.parse(message.toString());
        if (typeof data === "undefined" || data == null) throw "no-data";

        switch (topic) {
          case "lcu/live/summoner":
            this._cache.summoner =
              typeof data !== "undefined" && data ? data : null;
            break;
          case "lcu/instance":
            this.online =
              typeof data.status !== "undefined" && data.status === true;
            break;
          case "lcu/client":
            this.version =
              typeof data.version === "string" && data.version.trim().length > 0
                ? data.version
                : null;
            break;
        }
        this.ready =
          this.connected === true &&
          this.version !== null &&
          this._cache.summoner !== null;
      } catch (_) {}

      if (!this.ready) {
        this._cache = {
          summoner: null,
          events: null,
          players: null,
          history: null,
          stats: null,
          currentGame: null,
          currentChampion: null
        };

        return;
      }
      this.lastTs = this._now();

      if (topic.startsWith("lcu/live/")) {
        const type = topic
          .replace("lcu/live/", "")
          .replace(/-(\w|$)/g, (_, x) => x.toUpperCase());

        this._update(
          type,
          data !== "undefined" && data !== null && data !== false ? data : null
        );
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

  _update(type, data) {
    const _old = this._cache[type] ?? null;
    const _new = data ?? null;
    if (this._hasChanged(_old, _new)) {
      this._cache[type] = _new;
      if (!["inGame"].includes(this._cache.summoner.gameStatus)) {
        if (!["championSelect"].includes(this._cache.summoner.gameStatus))
          this._cache.currentChampion = null;
        this._cache.players = null;
        this._cache.currentGame = null;
        this._cache.events = null;
      }
    }
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

  // Socket Notification Received
  socketNotificationReceived: function (notification, payload) {
    this._notificationReceived(
      notification.replace(new RegExp(`${this.name}-`, "gi"), ""),
      payload
    );
  },

  setProxy() {
    const proxy = createProxyMiddleware({
      target: "https://ddragon.leagueoflegends.com",
      changeOrigin: true,
      pathRewrite: {
        [`/${this.name}/cdn`]: "/cdn"
      },
      onProxyReq: (proxyReq, req, ..._) => {
        req.headers["cache-control"] = undefined;
        req.headers.pragma = undefined;
        proxyReq.removeHeader("Cache-Control");
        proxyReq.removeHeader("Pragma");
      }
    });
    this.expressApp.use(`/${this.name}/cdn`, proxy);
  }
});
