const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    name: {
      type: String,
      trim: true,
      default: '',
      validate: {
        validator(value) {
          return !value || (value.length >= 3 && value.length <= 20);
        },
        message: 'Name must be 3 to 20 characters',
      },
    },

    coins: {
      type: Number,
      default: 100,
      min: 0,
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
  },
  { optimisticConcurrency: true, timestamps: true }
);

userSchema.index({ name: 1 });

module.exports = mongoose.model("User", userSchema);
