function normalizeStatus(eventStatus) {
    if (!eventStatus) return "UNKNOWN";
  
    if (eventStatus.includes("Scheduled")) return "UPCOMING";
    if (eventStatus.includes("InProgress")) return "LIVE";
    if (eventStatus.includes("Completed")) return "COMPLETED";
  
    return "UNKNOWN";
  }
  
  function parseJsonLD($) {
    const scripts = $("script[type='application/ld+json']");
  
    for (const script of scripts) {
      try {
        const json = JSON.parse($(script).html());
  
        if (json["@type"] !== "ItemList") continue;
  
        return json.itemListElement.map(({ item }) => ({
          provider: "16score",
  
          tournament: item.organizer?.name || null,
  
          matchName: item.name || null,
  
          matchUrl: item.url || item.offers?.url || null,
  
          startTime: item.startDate || null,
  
          endTime: item.endDate || null,
  
          status: normalizeStatus(item.eventStatus),
        }));
      } catch {}
    }
  
    return [];
  }
  
  module.exports = parseJsonLD;