const fs = require("fs");
const parseMatch = require("../parsers/matchParser");

const html = fs.readFileSync("matchPage.html", "utf8");

const data = parseMatch(html);

console.dir(data, {
  depth: null,
});