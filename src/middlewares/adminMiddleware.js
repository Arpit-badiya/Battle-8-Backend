const User = require("../models/User");

const adminMiddleware = async (req, res, next) => {
  try {
    const user = req.user?.role ? req.user : await User.findById(req.user.id);

    if (!user || user.role !== "admin") {
      return res.status(403).json({
        message: "Admin access only",
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = adminMiddleware;
