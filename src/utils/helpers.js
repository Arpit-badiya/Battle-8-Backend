const mongoose = require('mongoose');

const normalizeEmail = (email = '') => String(email).trim().toLowerCase();

const isValidEmail = (email = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const normalizeDisplayName = (name = '') =>
  String(name).trim().replace(/\s+/g, ' ');

const validateDisplayName = (name = '') => {
  const normalized = normalizeDisplayName(name);

  if (normalized.length < 3 || normalized.length > 20) {
    return {
      valid: false,
      name: normalized,
      message: 'Display name must be 3 to 20 characters',
    };
  }

  return {
    valid: true,
    name: normalized,
  };
};

const getContestStart = (plain = {}) => plain.startTime || plain.startsAt || null;
const getContestEnd = (plain = {}) => plain.endTime || plain.endsAt || null;

const getEffectiveContestStatus = (contest = {}) => {
  const plain = contest?.toObject ? contest.toObject() : contest;

  if (plain.status === 'completed' || plain.status === 'cancelled') {
    return plain.status;
  }

  if (plain.status === 'live') {
    return 'live';
  }

  const start = getContestStart(plain);

  if (start && new Date(start).getTime() <= Date.now()) {
    return 'live';
  }

  return 'upcoming';
};

const normalizeContest = (contest, userId = null) => {
  const plain = contest?.toObject ? contest.toObject() : contest;

  if (!plain) {
    return null;
  }

  const joined = Number(plain.joined || 0);
  const players = Number(plain.players || plain.totalSpots || 0);
  const entryFee = Number(plain.entryFee || 0);
  const totalCollection = Number(plain.totalCollection ?? entryFee * joined);
  const prizePool = Number(plain.prizePool ?? totalCollection);
  const participants = plain.participants || [];
  const status = getEffectiveContestStatus(plain);
  const userJoined = userId
    ? participants.some((participant) => String(participant) === String(userId))
    : false;

  return {
    ...plain,
    id: plain._id,
    joined,
    players,
    entryFee,
    totalCollection,
    prizePool,
    totalSpots: players,
    startTime: getContestStart(plain),
    endTime: getContestEnd(plain),
    estimatedEndTime: plain.estimatedEndTime || null,
    status,
    contestPlayers: plain.contestPlayers || [],
    platformCommissionPercent: Number(plain.platformCommissionPercent || 0),
    totalCollection: Number(plain.totalCollection || 0),
    platformCommissionAmount: Number(plain.platformCommissionAmount || 0),
    remainingSlots: Math.max(players - joined, 0),
    isFull: players > 0 && joined >= players,
    userJoined,
  };
};

module.exports = {
  isValidEmail,
  isValidObjectId,
  normalizeContest,
  normalizeDisplayName,
  normalizeEmail,
  getEffectiveContestStatus,
  validateDisplayName,
};
