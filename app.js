const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const sanitizeRequest = require("./src/middlewares/sanitizeMiddleware");
const requestLogger = require("./src/middlewares/requestLogger");
const { apiRateLimit, authRateLimit } = require("./src/middlewares/rateLimitMiddleware");
const { errorHandler, notFound } = require("./src/middlewares/errorMiddleware");

const app = express();

app.set("trust proxy", 1);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  })
);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(sanitizeRequest);
app.use(requestLogger);
app.use("/api/auth", authRateLimit);
app.use("/api", apiRateLimit);

app.get("/", (req, res) => {
  res.send("API running");
});

app.use("/api/auth", require("./src/routes/authRoutes"));

app.use("/api/contests", require("./src/routes/contestRoutes"));

app.use("/api/team", require("./src/routes/teamRoutes"));

app.use("/api/wallet", require("./src/routes/walletRoutes"));

app.use("/api/ads", require("./src/routes/adRewardRoutes"));

app.use("/api/withdrawals", require("./src/routes/withdrawalRoutes"));

app.use("/api/premium", require("./src/routes/premiumRoutes"));

app.use("/api/profile", require("./src/routes/profileRoutes"));

app.use(
  "/api/leaderboard",
  require("./src/routes/leaderboardRoutes")
);

app.use("/api/results", require("./src/routes/resultRoutes"));

app.use("/api/admin", require("./src/routes/adminRoutes"));

app.use("/api/players", require("./src/routes/playerRoutes"));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
