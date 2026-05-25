const dns = require("dns");

dns.setServers(["8.8.8.8", "8.8.4.4"]);

require("dotenv").config();

const http = require("http");
const app = require("./app");
const connectDB = require("./src/config/db");
const { connectRedis } = require("./src/services/cacheService");
const { startContestLifecycleScheduler } = require("./src/services/contestLifecycleService");
const { initRealtime } = require("./src/services/realtimeService");
const logger = require("./src/utils/logger");

const startServer = async () => {
  try {
    await connectDB();
    await connectRedis();

    const port = process.env.PORT || 5000;
    const server = http.createServer(app);

    initRealtime(server);
    startContestLifecycleScheduler();

    server.listen(port, "0.0.0.0", () => {
      logger.info("server_started", { port });
    });
  } catch (error) {
    logger.error("server_start_failed", { error });
    process.exit(1);
  }
};

startServer();
