"use strict";
// Live smoke test — connects to the real broker, subscribes data.state.updated,
// runs the full node_helper pipeline (unwrap -> DDragon -> transform) and prints
// the notifications the front would receive. Subscribe-only, never publishes.
// Run: node test/smoke.js

const Module = require("node:module");

const stubs = {
  node_helper: { create: (obj) => obj },
  logger: {
    log: (...a) => console.log("[log]", ...a),
    info: (...a) => console.log("[info]", ...a),
    debug: () => {},
    error: (...a) => console.log("[error]", ...a),
    warn: (...a) => console.log("[warn]", ...a)
  }
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(stubs, request))
    return stubs[request];
  return origLoad.call(this, request, ...rest);
};

const helper = require("../node_helper.js");

helper.config = { broker: "192.168.0.2", port: 1883 };
helper._cache = {
  summoner: null,
  events: null,
  players: null,
  history: null,
  stats: null,
  currentGame: null,
  currentChampion: null
};
helper.sendSocketNotification = (notification, payload) => {
  console.log(`\n>> ${notification}`);
  console.log(JSON.stringify(payload, null, 2));
};

console.log("Connecting to broker 192.168.0.2:1883 ...");
helper.connectToBroker();

setTimeout(() => {
  console.log("\n--- smoke done ---");
  if (helper.client) helper.client.end(true);
  process.exit(0);
}, 12000);
