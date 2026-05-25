require('dotenv').config();

const dns = require('dns');
const mongoose = require('mongoose');
const User = require('../src/models/User');

dns.setServers(['8.8.8.8', '8.8.4.4']);

const normalizeEmail = (email = '') => String(email).trim().toLowerCase();

const makeAdmin = async () => {
  const email = normalizeEmail(process.argv[2] || process.env.ADMIN_EMAIL);

  if (!email) {
    throw new Error('Provide an email: npm run make-admin -- user@example.com');
  }

  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const user = await User.findOneAndUpdate(
    { email },
    { $set: { role: 'admin' } },
    { new: true }
  ).select('email role');

  if (!user) {
    throw new Error(`User not found for email: ${email}. Login once first, then run this again.`);
  }

  console.log(`Admin enabled: ${user.email} (${user.role})`);
};

makeAdmin()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
