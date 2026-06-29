const axios = require("axios");

async function fetchHTML(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 15000,
    });

    return response.data;
  } catch (error) {
    console.error("❌ Fetch Error:", error.message);
    return null;
  }
}

module.exports = fetchHTML;