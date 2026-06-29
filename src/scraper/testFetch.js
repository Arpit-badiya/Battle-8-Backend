require("dotenv").config();

const cheerio = require("cheerio");

const { MATCHES } = require("./providers/16score/urls");
const fetchHTML = require("./providers/16score/fetch");
const parseJsonLD = require("./parsers/jsonParser");

(async () => {
  console.log("🚀 Testing Fetch...\n");

  const html = await fetchHTML(MATCHES.LIVE);

  if (!html) {
    console.log("❌ Failed to fetch HTML");
    return;
  }

  console.log("📄 HTML Length:", html.length);

  const $ = cheerio.load(html);

  const matches = parseJsonLD($);

  console.log("\n✅ Total Matches:", matches.length);

  if (matches.length > 0) {
    console.table(matches);
  }
})();