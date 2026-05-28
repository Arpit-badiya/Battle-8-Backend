const { createClient } = require('redis');
const logger = require('../utils/logger');

let client = null;
let ready = false;

const connectRedis = async () => {
  if (!process.env.REDIS_URL || client) {
    return client;
  }

  client = createClient({ url: process.env.REDIS_URL });

  client.on('error', (error) => {
    ready = false;
    logger.warn('redis_error', { error });
  });

  client.on('ready', () => {
    ready = true;
    logger.info('redis_ready');
  });

  try {
    await client.connect();
  } catch (error) {
    ready = false;
    logger.warn('redis_unavailable', { error });
  }

  return client;
};

const get = async (key) => {
  if (!ready || !client) return null;

  try {
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    logger.warn('redis_get_failed', { key, error });
    return null;
  }
};

const set = async (key, value, ttlSeconds = 60) => {
  if (!ready || !client) return false;

  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
    return true;
  } catch (error) {
    logger.warn('redis_set_failed', { key, error });
    return false;
  }
};

const del = async (...keys) => {
  if (!ready || !client || keys.length === 0) return false;

  try {
    await client.del(keys);
    return true;
  } catch (error) {
    logger.warn('redis_del_failed', { keys, error });
    return false;
  }
};

const contestListKeys = () => [
  'contests:list',
  'contests:list:BGMI',
  'contests:list:Free Fire',
  'contests:list:Valorant',
  'contests:list:COD Mobile',
];

const delContestLists = async (...extraKeys) =>
  del(...contestListKeys(), ...extraKeys);

const publish = async (channel, payload) => {
  if (!ready || !client) return false;

  try {
    await client.publish(channel, JSON.stringify(payload));
    return true;
  } catch (error) {
    logger.warn('redis_publish_failed', { channel, error });
    return false;
  }
};

const incrWithTtl = async (key, ttlSeconds) => {
  if (!ready || !client) return null;

  try {
    const value = await client.incr(key);

    if (value === 1) {
      await client.expire(key, ttlSeconds);
    }

    return value;
  } catch (error) {
    logger.warn('redis_incr_failed', { key, error });
    return null;
  }
};

const setActiveMatchState = (contestId, state, ttlSeconds = 120) =>
  set(`matchState:${contestId}`, state, ttlSeconds);

const getActiveMatchState = (contestId) =>
  get(`matchState:${contestId}`);

module.exports = {
  connectRedis,
  del,
  delContestLists,
  get,
  getActiveMatchState,
  incrWithTtl,
  isReady: () => ready,
  publish,
  set,
  setActiveMatchState,
};
