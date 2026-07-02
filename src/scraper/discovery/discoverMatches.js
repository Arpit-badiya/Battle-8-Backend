const { chromium } = require("playwright");

async function discoverMatches(url) {
    const browser = await chromium.launch({
        headless: false,
    });

    const page = await browser.newPage();

    await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 60000,
    });

    const rows = page.locator('tr[role="button"]');
    const totalRows = await rows.count();

    console.log("✅ Total Match Rows:", totalRows);

    const matchUrls = [];

    for (let i = 0; i < totalRows; i++) {

        console.log(`Opening Row ${i + 1}`);

        await rows.nth(i).click();

        await page.waitForTimeout(1000);

        const button = page.locator('a:has-text("View full match")');

        if (await button.count()) {

            const href = await button.getAttribute("href");

            console.log("Found:", href);

            const fullUrl = "https://www.16score.com" + href;

            const matchNo = parseInt(
                fullUrl.match(/match-(\d+)/)[1]
            );

            matchUrls.push({
                matchNo,
                url: fullUrl,
                status: "pending",
            });

        } else {

            console.log("❌ View full match not found");

        }

    }

    await browser.close();
    matchUrls.sort((a, b) => a.matchNo - b.matchNo);

    return matchUrls;
}

module.exports = discoverMatches;