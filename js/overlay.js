/*jshint esversion: 6 */
let uuid = null,
  reloading = false,
  online = false,
  connected = false,
  version,
  lastTs = 0;

const cached = {
  summoner: undefined,
  events: undefined,
  players: undefined,
  history: undefined,
  stats: undefined,
  "current-game": undefined,
  "current-champion": undefined
};

const historyList = $(".history-list"),
  eventsList = $(".events-list"),
  playersList = $(".in-game-stats");

function removeItem() {
  $(this).remove();
}

function getPlayersRow(teams, i) {
  const row =
    playersList.find(".row-" + i).length === 0
      ? $("<div>").addClass("columns is-mobile row-" + i)
      : playersList.find(".row-" + i);
  for (const t of teams) {
    if (row.find("." + t.toLowerCase()).length === 0)
      $("<div>")
        .addClass("column")
        .addClass("is-half")
        .addClass("p-0")
        .addClass("m-0")
        .addClass(t.toLowerCase())
        .appendTo(row);
  }
  return row;
}

function getPlayerRow(player) {
  const playerClass = player.name.replace(/[^a-z0-9]/gim, "-");
  const direction =
    "is-flex-direction-row" + (player.team === "ORDER" ? "" : "-reverse");
  const row =
    playersList.find(".player-" + playerClass).length === 0
      ? $("<div>")
          .addClass("columns")
          .addClass("is-mobile")
          .addClass("is-gapless")
          .addClass("p-0")
          .addClass("m-0")
          .addClass("player")
          .addClass("player-" + playerClass)
          .addClass(direction)
          .addClass("is-align-content-center")
          .addClass("is-align-items-center")
      : playersList.find(".player-" + playerClass);

  if (player.isDead) {
    row.addClass("is-dead");
  } else {
    row.removeClass("is-dead");
  }

  if (row.find("> .avatar").length === 0) {
    $("<div>")
      .addClass("column avatar is-relative")
      .append(
        $("<img>", {
          src:
            "/cdn/img/champion/tiles/" +
            player.championAlias +
            "_" +
            player.skin +
            ".jpg"
        }).addClass("champion-avatar")
      )
      .append($("<div>").addClass("text is-overlay"))
      .appendTo(row);
  }

  if (row.find("> .items-stats").length === 0) {
    const itemsStats = $("<div>")
      .addClass("column is-flex-direction-column items-stats")
      .appendTo(row);

    const items = $("<div>")
      .addClass("columns is-mobile is-gapless p-0 m-0 items")
      .appendTo(itemsStats);

    for (let i = 0; i < 6; i++) {
      $("<div>")
        .addClass("column slot slot-" + i)
        .appendTo(items);
    }

    const stats = $("<div>")
      .addClass("columns is-mobile is-gapless p-0 m-0 stats")
      .appendTo(itemsStats);

    for (const cs of ["kills", "deaths", "assists"]) {
      $("<div>")
        .addClass("column stat " + cs)
        .appendTo(stats);
    }
    $("<div>")
      .addClass("column stat padder")
      [player.team === "ORDER" ? "appendTo" : "prependTo"](stats);
    $("<div>")
      .addClass("column stat creepScore")
      [player.team === "ORDER" ? "appendTo" : "prependTo"](stats);
  }

  // Score
  for (const cs of ["kills", "deaths", "assists", "creepScore"]) {
    row.find("> .items-stats ." + cs).text(player.scores[cs]);
  }

  for (let i = 0; i < 6; i++) {
    const slotItem = player.items.find((item) => item.slot === i);
    const slot = row.find("> .items-stats .slot-" + i);
    if (slotItem) {
      const itemAvatar =
        slot.find(".item-avatar").length === 0
          ? $("<img>").addClass("item-avatar").appendTo(slot)
          : slot.find("> .item-avatar");
      const itemImageUrl = `/cdn/${version}/img/item/${slotItem.itemID}.png`;
      if (itemAvatar.src !== itemImageUrl) itemAvatar.attr("src", itemImageUrl);
    } else {
      slot.text("");
    }
  }

  row.find("> .avatar > .text").text(Math.ceil(player.respawnTimer));

  return row;
}

function updatePlayers(players) {
  if (typeof players === "object" && Object.keys(players).length > 0) {
    const teams = Object.keys(players);
    let maxPlayers = 0;
    Object.values(players).forEach(
      (ps) => (maxPlayers = Math.max(maxPlayers, ps.length))
    );
    for (let i = 0; i < maxPlayers; i++) {
      let row = getPlayersRow(teams, i).appendTo(playersList);
      for (const team of teams) {
        if (players[team] && players[team].length > i) {
          getPlayerRow(players[team][i]).appendTo(
            row.find("> .column." + team.toLowerCase())
          );
        }
      }
    }
    playersList.show(0);
  } else {
    playersList.hide(0);
    playersList.find("> .columns").remove();
  }
  cached["players"] = players;
}

function appendHistoryItem(game, animate = false) {
  const item = $("<li>")
    .addClass("is-inline-block my-0 p-0 game-" + game.gameId)
    .addClass(game.win ? "won" : "lost")
    .data("gameId", game.gameId);
  $("<img>", {
    src:
      "/cdn/img/champion/tiles/" +
      game.champion.alias +
      "_" +
      game.champion.currentSkin.num +
      ".jpg"
  })
    .addClass("is-block")
    .appendTo(item);

  if (animate) item.css("margin-left", "-2rem");
  item.prependTo(historyList);
  if (animate)
    item.animate({ marginLeft: "0rem" }, "fast", function () {
      $(this).removeAttr("style");
    });
}

function updateHistory(history) {
  const maxLength = 10;
  if (Array.isArray(history) && history.length > 0) {
    history = history
      .slice(0, maxLength)
      .sort((a, b) => (a.gameId > b.gameId ? 1 : b.gameId > a.gameId ? -1 : 0));
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
      if (i < toAdd.length) {
        appendHistoryItem(
          toAdd[i],
          historyList.find("> li").length > maxLength - 1
        );
      }
      if (i < toDelete.length) {
        toDelete[i].animate({ marginRight: "-2rem" }, "fast", removeItem);
      }
    }
  } else {
    historyList.children().remove();
  }
  cached["history"] = history;
}

function updateEvents(events) {
  if (Array.isArray(events) && events.length > 0) {
    const receivedEventIds = events.map(function (e) {
      return e.id;
    });
    const currentEventIds = [];
    const toDelete = [];
    const toAdd = [];
    eventsList.find("> .event").each(function (_, li) {
      const item = $(li),
        eventId = item.data("eventId");
      if (receivedEventIds.includes(eventId)) {
        currentEventIds.push(eventId);
      } else {
        toDelete.push(item);
      }
    });
    events.forEach(function (event) {
      if (currentEventIds.includes(event.id)) return;
      toAdd.push(event);
    });

    if (Math.max(toAdd.length, toDelete.length) === 0) return;

    for (let i = 0; i < Math.max(toAdd.length, toDelete.length); i++) {
      const currentCount = eventsList.find("> .event").length;
      if (i < toAdd.length) {
        eventsList
          .getEventPlaceholder(toAdd[i], currentCount)
          .animate({ marginTop: "0rem", opacity: 1 }, "fast");
      }
      if (i < toDelete.length) {
        toDelete[i].animate({ marginTop: "-2.5rem" }, "fast", removeItem);
      }
    }
    $(".recent-events").show(0);
  } else {
    eventsList.children().remove();
    $(".recent-events").hide(0);
  }
  cached["events"] = events;
}

function updateCurrentChampion(currentChampion) {
  if (typeof currentChampion === "object") {
    if (currentChampion.hasOwnProperty("alias") && currentChampion.alias) {
      $(".main-info .current-champion-splash")
        .removeClass("is-hidden")
        .css(
          "background-image",
          `url("/cdn/img/champion/centered/${currentChampion.alias}_${currentChampion.currentSkin.num}.jpg")`
        );
    } else {
      $(".main-info .current-champion-splash")
        .addClass("is-hidden")
        .css("background-image", "none");
    }
    if (
      currentChampion.hasOwnProperty("currentSkin") &&
      currentChampion.currentSkin
    ) {
      $(".banner-icon img").attr(
        "src",
        `/cdn/img/champion/tiles/${currentChampion.alias}_${currentChampion.currentSkin.num}.jpg`
      );
      $(".main-info .bottom .current-champion-name")
        .removeClass("is-hidden")
        .text(currentChampion.currentSkin.name);
    } else {
      $(".main-info .bottom .current-champion-name")
        .addClass("is-hidden")
        .text("");
    }
  } else {
    $(".main-info .current-champion-splash")
      .addClass("is-hidden")
      .css("background-image", "none");
    $(".main-info .bottom .current-champion-name")
      .addClass("is-hidden")
      .text("");
  }
  cached["current-champion"] = currentChampion;
}

function updateCurrentGame(currentGame) {
  if (typeof currentGame === "object") {
    if (currentGame.hasOwnProperty("buddies") && currentGame.buddies) {
      $(".main-info .bottom .buddies")
        .removeClass("is-hidden")
        .text(currentGame.buddies);
    } else {
      $(".main-info .bottom .buddies").addClass("is-hidden").text("");
    }
    if (currentGame.hasOwnProperty("map") && currentGame.map) {
      $(".main-info .bottom .current-map")
        .removeClass("is-hidden")
        .text(currentGame.map);
    } else {
      $(".main-info .bottom .current-map").addClass("is-hidden").text("");
    }
    const parts = [
      currentGame["mode"] ? currentGame["mode"] : undefined,
      currentGame["gameQueueTypeLabel"]
        ? currentGame["gameQueueTypeLabel"]
        : undefined
    ].filter(function (l) {
      return typeof l === "string";
    });
    if (parts.length > 0) {
      $(".main-info .bottom .current-mode")
        .removeClass("is-hidden")
        .text(parts.join(", "));
    } else {
      $(".main-info .bottom .current-mode").addClass("is-hidden").text("");
    }
  } else {
    $(".main-info .bottom .current-map").addClass("is-hidden").text("");
    $(".main-info .bottom .current-mode").addClass("is-hidden").text("");
    $(".main-info .bottom .buddies").addClass("is-hidden").text("");
  }
  cached["current-game"] = currentGame;
}

function updateStats(stats) {
  if (stats.hasOwnProperty("matches"))
    $(".banner-extra .value.matches").text(stats.matches + "");
  if (stats.hasOwnProperty("winRatio"))
    $(".banner-extra .value.win-ratio").text(stats.winRatio + "%");
  if (stats.hasOwnProperty("kda"))
    $(".banner-extra .title.kda span:last-child").text(stats.kda + "");
  if (
    stats.hasOwnProperty("kills") &&
    stats.hasOwnProperty("deaths") &&
    stats.hasOwnProperty("assists")
  )
    $(".banner-extra .value.kda").text(
      stats.kills + " / " + stats.deaths + " / " + stats.assists
    );
  cached["stats"] = stats;
}

function updateSummoner(summoner) {
  $(".overlay").attr("class", "overlay");
  // if (summoner.hasOwnProperty("xpProgress")) knob.setValue(summoner.xpProgress);
  if (
    summoner.hasOwnProperty("profileIcon") &&
    (typeof cached["current-champion"] === "undefined" ||
      !cached["current-champion"])
  ) {
    $(".banner-icon img").attr(
      "src",
      "/cdn/" + version + "/img/profileicon/" + summoner.profileIcon + ".png"
    );
  }
  if (summoner.hasOwnProperty("summonerLevel"))
    $(".banner-level .center").text(summoner.summonerLevel);
  if (summoner.hasOwnProperty("name"))
    $(".main-info .top .username").text(summoner.name);
  if (summoner.hasOwnProperty("gameStatus")) {
    $(".overlay").addClass(
      summoner.gameStatus.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())
    );
    if (["inGame", "spectating"].includes(summoner.gameStatus)) {
      updatePlayers({});
    }

    $(".main-info .bottom .game-status").text(summoner.gameStatusLabel);
  }
  cached["summoner"] = summoner;
}

function toggleOverlay(show = false) {
  if (show) {
    $(".overlay").removeAttr("style");
    $(".loading-wrapper").css("display", "none");
  } else {
    $(".overlay").css("display", "none");
    $(".loading-wrapper").removeAttr("style");
  }
}

function hasChanged(key, data) {
  return (
    typeof version !== "undefined" &&
    (typeof cached[key] === "undefined" ||
      JSON.stringify(cached[key]) !== JSON.stringify(data))
  );
}

setInterval(() => {
  const now = new Date().getTime();
  if (lastTs - now > 750) toggleOverlay(false);
}, 100);

const handleOverlay = (config) => {
  const url = `ws://${config.mqttBroker}:8083/mqtt`;
  // Create an MQTT client instance
  const options = {
    // Clean session
    clean: true,
    connectTimeout: 4000,
    // Authentication
    clientId: "emqx_test",
    username: "emqx_test",
    password: "emqx_test"
  };

  const client = mqtt.connect(url, options);
  client.on("connect", function () {
    console.debug("mqtt-connect");
    connected = true;
    // Subscribe to a topic
    client.subscribe("lcu/+");
    client.subscribe("lcu/live/+");
  });

  client.on("error", (..._) => {
    connected = false;
    console.debug("mqtt-error");
  });
  client.on("reconnect", () => {
    connected = false;
    console.debug("mqtt-reconnect");
  });
  client.on("offline", () => {
    connected = false;
    console.debug("mqtt-offline");
  });
  client.on("end", () => {
    connected = false;
    console.debug("mqtt-end");
  });
  client.on("close", () => {
    connected = false;
    console.debug("mqtt-close");
  });

  // Receive messages
  client.on("message", (topic, message) => {
    if (reloading) {
      toggleOverlay(false);
      return;
    }
    const now = new Date().getTime();
    lastTs = now;
    let data;
    try {
      data = JSON.parse(message.toString());
      // No data received
      if (typeof data === "undefined" || data == null) {
        throw new Error("no-data");
      }

      switch (topic) {
        case "lcu/instance":
          newUuid =
            typeof data.uuid === "string" && data.uuid.trim().length > 0
              ? data.uuid
              : null;
          if (typeof uuid === "string" && uuid !== newUuid)
            throw "should-reload";
          else uuid = newUuid;
          online =
            uuid !== null &&
            typeof data.status !== "undefined" &&
            data.status !== null &&
            data.status === true;
          break;
        case "lcu/client":
          version =
            typeof data.version === "string" && data.version.trim().length > 0
              ? data.version
              : null;
          break;
      }

      toggleOverlay(online && connected);
      if (!online) throw "should-wait";
    } catch (error) {
      if (`${error}` === "should-wait") return;
      if (`${error}` === "should-reload") {
        reloading = true;
        console.log("Server UUID mismatch. Reloading...");
        setTimeout(function () {
          window.location.reload();
        }, 500);
        return;
      }

      console.log(error);
    }

    switch (topic) {
      case "lcu/live/history":
        if (hasChanged("history", data)) updateHistory(data);
        break;
      case "lcu/live/summoner":
        if (hasChanged("summoner", data)) updateSummoner(data);
        break;
      case "lcu/live/stats":
        if (hasChanged("stats", data)) updateStats(data);
        break;
      case "lcu/live/current-champion":
        if (hasChanged("current-champion", data)) updateCurrentChampion(data);
        break;
      case "lcu/live/current-game":
        if (hasChanged("current-game", data)) updateCurrentGame(data);
        break;
      case "lcu/live/players":
        if (hasChanged("players", data)) updatePlayers(data);
        break;
      case "lcu/live/events":
        if (hasChanged("events", data)) updateEvents(data);
        break;
    }
  });
};

const init = () => {
  fetch("/config.json")
    .then((response) => response.json())
    .then((config) => handleOverlay(config))
    .catch(() => setTimeout(() => init(), 250));
};
