"use strict";
// Unit test for node_helper's _mapPlayers — no MagicMirror, no broker.
// Run: node test/players.test.js
//
// Stubs the MagicMirror core modules so node_helper.js loads standalone, then
// exercises the player transform with a payload shaped like the players[]
// array from the `data.state.updated` MQTT topic.

const assert = require("node:assert");
const Module = require("node:module");

const stubs = {
  node_helper: { create: (obj) => obj },
  logger: { log() {}, info() {}, debug() {}, error() {}, warn() {} }
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(stubs, request))
    return stubs[request];
  return origLoad.call(this, request, ...rest);
};

const helper = require("../node_helper.js");

helper._champions = {
  157: { alias: "Yasuo", name: "Yasuo" },
  62: { alias: "MonkeyKing", name: "Wukong" }
};
helper._championDetail = {
  Yasuo: {
    0: "default",
    1: "High Noon Yasuo",
    5: "Worldbreaker Yasuo (Obsidian)"
  },
  MonkeyKing: { 0: "default" }
};

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`  ok  ${label}`);
}

const players = [
  {
    team: "ORDER",
    championId: 157,
    skinId: 157001,
    items: [
      { slot: 0, itemID: 3006 },
      { slot: 1, itemID: 6672 }
    ],
    scores: { kills: 7, deaths: 2, assists: 4 },
    dead: false,
    me: true
  },
  {
    team: "CHAOS",
    championId: 62,
    skinId: 62000,
    items: [],
    scores: { kills: 1, deaths: 5, assists: 3 },
    dead: true,
    me: false
  }
];

console.log("_mapPlayers");
const teams = helper._mapPlayers(players);

check("grouped by team", () =>
  assert.deepStrictEqual(Object.keys(teams).sort(), ["CHAOS", "ORDER"])
);
check("champion alias resolved via DDragon map", () => {
  assert.strictEqual(teams.ORDER[0].championAlias, "Yasuo");
  assert.strictEqual(teams.CHAOS[0].championAlias, "MonkeyKing");
});
check(
  "skin number derived from skinId",
  () => assert.strictEqual(teams.ORDER[0].skinNum, 1) // 157001 % 1000
);
check("championName = skin name, base skin falls back to champion name", () => {
  assert.strictEqual(teams.ORDER[0].championName, "High Noon Yasuo"); // skin 1
  assert.strictEqual(teams.CHAOS[0].championName, "Wukong"); // skin 0 -> default
});
check("chroma suffix is stripped from the skin name", () =>
  assert.strictEqual(
    helper._skinLabel("Yasuo", "Yasuo", 5),
    "Worldbreaker Yasuo"
  )
);
check("items carry raw itemID + slot", () => {
  assert.strictEqual(teams.ORDER[0].items[0].slot, 0);
  assert.strictEqual(teams.ORDER[0].items[0].itemID, 3006);
  assert.strictEqual(teams.CHAOS[0].items.length, 0);
});
check("scores carried (kills/deaths/assists only)", () => {
  assert.deepStrictEqual(teams.ORDER[0].scores, {
    kills: 7,
    deaths: 2,
    assists: 4
  });
});
check("dead flag mapped", () => {
  assert.strictEqual(teams.ORDER[0].isDead, false);
  assert.strictEqual(teams.CHAOS[0].isDead, true);
});
check("mode variant id (60000 + base) resolves to the base champion", () => {
  // Jade_Yasuo-style variants: CommunityDragon lists them, DDragon does not.
  const t = helper._mapPlayers([
    { team: "ORDER", championId: 60157, skinId: 1, items: [], scores: {} }
  ]);
  assert.strictEqual(t.ORDER[0].championAlias, "Yasuo");
  assert.strictEqual(t.ORDER[0].championName, "High Noon Yasuo");
});
check("unknown champion id degrades safely", () => {
  const t = helper._mapPlayers([
    { team: "ORDER", championId: 99999, skinId: 0, items: [], scores: {} }
  ]);
  assert.strictEqual(t.ORDER[0].championAlias, "None");
});

console.log("\n_handleState");
check("TFT match never activates the overlay", () => {
  const sent = [];
  helper.sendSocketNotification = (n, p) => sent.push([n, p]);
  helper.ready = true;
  // sync assertions are safe: the idle path returns before any await
  helper._handleState({
    connected: true,
    phase: "InProgress",
    mode: "TFT",
    players
  });
  assert.strictEqual(helper.ready, false);
  assert.deepStrictEqual(sent.at(-1), [
    "MMM-LeagueStats-READY",
    { ready: false }
  ]);
});

console.log("\n_onClientInfo");
check("locale change drops DDragon caches and replays last state", () => {
  let replayed = null;
  helper._handleState = (d) => {
    replayed = d;
  };
  helper._lastState = { connected: true, phase: "InProgress", players };

  helper._onClientInfo({ region: "LA1", locale: "es_MX" });
  assert.strictEqual(helper._locale, "es_MX");
  assert.strictEqual(helper._champions, null);
  assert.deepStrictEqual(helper._championDetail, {});
  assert.strictEqual(replayed, helper._lastState);

  // same locale again -> no-op, no replay
  replayed = null;
  helper._onClientInfo({ region: "LA1", locale: "es_MX" });
  assert.strictEqual(replayed, null);

  // garbage payload -> ignored
  helper._onClientInfo({});
  assert.strictEqual(helper._locale, "es_MX");
});

console.log(`\n${passed} checks passed`);
