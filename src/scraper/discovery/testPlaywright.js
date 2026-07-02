const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: false,
  });

  const page = await browser.newPage();

  await page.goto(
    "https://www.16score.com/bgmi-series/bmps-2026/matches",
    {
      waitUntil: "networkidle",
      timeout: 60000,
    }
  );

  console.log("Title:", await page.title());
  console.log("URL:", page.url());

  // Screenshot lo
  await page.screenshot({
    path: "tournament-page.png",
    fullPage: true,
  });

  console.log("✅ Screenshot saved");

  // 10 sec browser khula rahe
  await page.waitForTimeout(10000);

  await browser.close();
})();