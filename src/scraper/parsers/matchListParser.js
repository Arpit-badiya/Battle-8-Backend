const cheerio = require("cheerio");

function parse(html) {
    const $ = cheerio.load(html);

    $("script").each((i, el) => {

        const text = $(el).html() || "";

        if(text.includes("match-1") || text.includes("bgmi-series"))
        {
            console.log(text.substring(0,5000));
        }

    });

}

module.exports=parse;