(function ($) {
  function toPosition(position) {
    switch (position) {
      case "FOUNTAIN":
        return "de Fuente";
      case "NEXUS":
        return "de Nexo";
      case "INHIB":
        return "de Inhibidor";
      case "INNER":
        return "Interior";
      case "OUTER":
        return "Exterior";
    }
    return "";
  }

  function toLane(lane) {
    switch (lane) {
      case "TOP":
        return "Superior";
      case "MIDDLE":
        return "Central";
      case "BOTTOM":
        return "Inferior";
    }
    return "";
  }

  $.fn.addLabel = function (extraClasses = null) {
    $("<div>")
      .addClass("text")
      .addClass(extraClasses ?? "")
      .appendTo(this);
    return this;
  };

  $.fn.addAnnouncement = function (announcement = null) {
    if (this.find(".victim").length === 0)
      this.addContainer("victim").find(".victim .text").remove();
    const container = this.find(".victim");

    $("<div>")
      .addClass("announcement")
      .text(announcement ?? "")
      .appendTo(container);
    return this;
  };

  $.fn.addAvatar = function (prepend = false) {
    $("<img>").addClass("avatar")[prepend ? "prependTo" : "appendTo"](this);
    return this;
  };

  $.fn.addContainer = function (role, extraClasses = null, addAvatar = false) {
    const container = $("<div>")
      .addClass("column")
      .addClass(role ?? "")
      .addClass(extraClasses ?? "")
      // Label
      .addLabel();
    // Avatar
    if (addAvatar === true) container.addAvatar(role === "killer");

    container[[role === "killer" ? "prependTo" : "appendTo"]](this);
    return this;
  };

  $.fn.setRoleName = function (role, name) {
    this.find("." + role + " > .text").text(name);
    return this;
  };

  $.fn.setRoleAvatar = function (role, src) {
    this.find("." + role + " > .avatar").attr("src", src);
    return this;
  };

  $.fn.addPlayerContainer = function (e, role) {
    this.addContainer(role, e.data[role].team.toLowerCase(), true);
    this.setRoleAvatar(
      role,
      "/cdn/img/champion/tiles/" +
        e.data[role].championAlias +
        "_" +
        e.data[role].skin +
        ".jpg"
    );
    // this.setRoleName(role, e.data[role].name);
    // this.setRoleName(role, e.data[role].skinName);
    this.setRoleName(role, e.data[role].championName);
    return this;
  };

  $.fn.addNpcContainer = function (e, role) {
    let npcName = "",
      npcType = null,
      npcClasses = [];

    if (typeof e.data[role].team !== "undefined") {
      npcClasses.push(e.data[role].team.toLowerCase());
    }
    if (typeof e.data[role].type !== "undefined") {
      npcType = e.data[role].type.toLowerCase();
      npcClasses.push(npcType);
      switch (npcType) {
        case "barracks":
          npcName = "Inhibidor " + toLane(e.data[role].lane);
          break;
        case "turret":
          npcName =
            "Torreta " +
            (e.data[role].id === "OBELISK"
              ? "de Azir"
              : toPosition(e.data[role].position));
          break;
        case "air":
          npcClasses.push("dragon");
          npcName = "Dragón de Viento";
          break;
        case "chemtech":
          npcClasses.push("dragon");
          npcName = "Dragón Chemtech";
          break;
        case "earth":
          npcClasses.push("dragon");
          npcName = "Dragón de Montaña";
          break;
        case "elder":
          npcClasses.push("dragon");
          npcName = "Dragón Ancestro";
          break;
        case "fire":
          npcClasses.push("dragon");
          npcName = "Dragón Infernal";
          break;
        case "hextech":
          npcClasses.push("dragon");
          npcName = "Dragón Hextech";
          break;
        case "ruined":
          npcClasses.push("dragon");
          npcName = "Dragón Arruinado";
          break;
        case "water":
          npcClasses.push("dragon");
          npcName = "Dragón de Océano";
          break;
        case "baron":
          npcName = "Barón Nashor";
          break;
        case "herald":
          npcName = "Heraldo";
          break;
        case "razorbeak":
          npcName = "Razorbeak";
          break;
        case "murkwolf":
          npcName = "Murk Wolf";
          break;
        case "krug":
          npcName = "Krug";
          break;
        case "blue":
          npcName = "Blue Centinel";
          break;
        case "red":
          npcName = "Red Brambleback";
          break;
        case "gromp":
          npcName = "Gromp";
          break;
        case "minion":
          npcName = "Minion";
          break;
      }
    }
    return this.addContainer(role, npcClasses.join(" ")).setRoleName(
      role,
      npcName
    );
  };

  $.fn.getEventPlaceholder = function (e, c) {
    const item = $("<div>")
      .addClass("columns")
      .addClass("is-mobile")
      .addClass("is-gapless")
      .addClass("is-vcentered")
      .addClass("event")
      .addClass(e.type)
      .css("margin-top", Math.max(0, 12.5 - c * 2.5) + "rem")
      .css("opacity", 0)
      .data("eventId", e.id)
      .appendTo(this);

    $("<div>").addClass("column").addClass("separator").appendTo(item);

    switch (e.type) {
      case "game-end":
        item
          .removeClass("columns")
          .addClass("block")
          .find(".separator")
          .remove();
        item.addLabel("block");
        item.addClass(e.data.win ? "victory" : "defeat");
        break;
      case "dragon-kill":
      case "baron-kill":
      case "herald-kill":
        item.addPlayerContainer(e, "killer").addNpcContainer(e, "victim");
        item.addClass(e.data.victim.type ?? "");
        if (
          e.data.hasOwnProperty("stolen") &&
          typeof e.data.stolen !== "undefined"
        ) {
          item.addClass("stolen");
        }
        break;
      case "ace":
      case "multikill":
      case "first-brick":
      case "first-blood":
        if (
          e.data.hasOwnProperty("killer") &&
          typeof e.data.killer !== "undefined"
        ) {
          if (
            e.data.killer.hasOwnProperty("id") &&
            typeof e.data.killer.id !== "undefined"
          ) {
            item.addNpcContainer(e, "killer");
          } else {
            item.addPlayerContainer(e, "killer");
          }
        }
        item.addAnnouncement(e.data.label);
        break;
      case "champion-kill":
      case "turret-killed":
      case "inhib-killed":
        if (
          e.data.hasOwnProperty("killer") &&
          typeof e.data.killer !== "undefined"
        ) {
          if (
            e.data.killer.hasOwnProperty("id") &&
            typeof e.data.killer.id !== "undefined"
          ) {
            item.addNpcContainer(e, "killer");
          } else {
            item.addPlayerContainer(e, "killer");
          }
        }
        if (
          e.data.hasOwnProperty("victim") &&
          typeof e.data.victim !== "undefined"
        ) {
          if (
            e.data.victim.hasOwnProperty("id") &&
            typeof e.data.victim.id !== "undefined"
          ) {
            item.addNpcContainer(e, "victim");
          } else {
            item.addPlayerContainer(e, "victim");
          }
        }
        break;
    }

    return item;
  };
})(jQuery);
