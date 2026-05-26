const jwt = require("jsonwebtoken");
const User = require("../models/User");

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Authentication token required",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        message: "Invalid token format",
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const user = await User.findById(decoded.id).select("_id email name role coins winningCoins premium");

    if (!user) {
      return res.status(401).json({
        message: "Invalid token user",
      });
    }

    req.user = {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      coins: user.coins,
      winningCoins: user.winningCoins || 0,
      premium: user.premium || {},
    };

    next();
  } catch (error) {
    return res.status(401).json({
      message: error.name === "TokenExpiredError" ? "Token expired" : "Invalid token",
    });
  }
};

module.exports = authMiddleware;
