require("dotenv").config();

const discoverMatches = require("./discovery/discoverMatches");

(async () => {

    const matches = await discoverMatches(
        "https://www.16score.com/bgmi-series/bmps-2026/matches"
    );

    console.log(matches);

})();