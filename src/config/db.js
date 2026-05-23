const mongoose = require("mongoose");
const logger = require("../utils/logger");

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is missing");
    }

    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: process.env.NODE_ENV !== "production",
    });

    const admin = mongoose.connection.db.admin();
    const serverStatus = await admin.command({ hello: 1 });

    if (!serverStatus.setName && process.env.NODE_ENV === "production") {
      logger.warn("mongodb_transactions_not_guaranteed", {
        message: "MongoDB is not reporting a replica set. Transactions require a replica set or sharded cluster.",
      });
    }

    logger.info("mongodb_connected", {
      host: serverStatus.me || serverStatus.primary || "unknown",
      replicaSet: serverStatus.setName || null,
    });
  } catch (error) {
    logger.error("mongodb_connect_error", { error });
    throw error;
  }
};

module.exports = connectDB;
