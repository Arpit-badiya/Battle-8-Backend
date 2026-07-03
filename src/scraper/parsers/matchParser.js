const cheerio = require("cheerio");

function parseMatch(html) {
  const $ = cheerio.load(html);

  const result = {
    matchNo: null,
    map: null,
    status: "completed",
    teams: [],
  };

  const scripts = $("script[type='application/ld+json']");

  scripts.each((_, script) => {
    try {
      const json = JSON.parse($(script).html());

      // ---------- Match Info ----------
      if (
        json["@type"] === "BreadcrumbList" &&
        Array.isArray(json.itemListElement)
      ) {
        const last =
          json.itemListElement[json.itemListElement.length - 1];

        if (last?.name) {
          const match = last.name.match(/Match\s+(\d+)\s*·\s*(.+)/i);

          if (match) {
            result.matchNo = Number(match[1]);
            result.map = match[2].trim();
          }
        }
      }

      // ---------- Leaderboard ----------
      if (
        json["@type"] === "ItemList" &&
        json.numberOfItems === 16
      ) {
        json.itemListElement.forEach((team) => {
          const props = {};

          team.item.additionalProperty.forEach((p) => {
            props[p.propertyID] = Number(p.value);
          });

          result.teams.push({
            placement: team.position,
            teamName: team.item.name,
            finishPoints: props["finish-points"],
            positionPoints: props["position-points"],
            totalPoints: props["total-points"],
          });
        });
      }
    } catch (err) {
      // Ignore invalid JSON
    }
  });

  return result;
}

module.exports = parseMatch;