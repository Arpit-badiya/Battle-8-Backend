require("dotenv").config();

const fs = require("fs");
const fetchHTML = require("./providers/16score/fetch");

(async () => {
  const url = "https://www.16score.com/bgmi-series";

  const html = await fetchHTML(url);

  console.log("HTML Length:", html.length);

  fs.writeFileSync("tournament-index.html", html);

  console.log("✅ Saved tournament-index.html");
})();