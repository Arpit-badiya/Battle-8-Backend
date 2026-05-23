const logger = require('../utils/logger');
const jwt = require('jsonwebtoken');

let io = null;
const lastEmitAt = new Map();
const MIN_EMIT_INTERVAL_MS = 250;

const initRealtime = (server) => {
  const { Server } = require('socket.io');

  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
    },
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      return next();
    } catch (error) {
      return next(new Error('Invalid socket token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info('socket_connected', { socketId: socket.id, userId: socket.user?.id });

    socket.on('contest:joinRoom', (contestId) => {
      if (contestId) {
        socket.join(`contest:${contestId}`);
      }
    });

    socket.on('contest:leaveRoom', (contestId) => {
      if (contestId) {
        socket.leave(`contest:${contestId}`);
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info('socket_disconnected', { socketId: socket.id, reason });
    });
  });

  return io;
};

const emit = (event, payload, room = null) => {
  if (!io) return;

  const key = `${room || 'global'}:${event}:${payload?.contestId || ''}`;
  const now = Date.now();
  const previous = lastEmitAt.get(key) || 0;

  if (now - previous < MIN_EMIT_INTERVAL_MS) {
    return;
  }

  lastEmitAt.set(key, now);

  if (room) {
    io.to(room).emit(event, payload);
    return;
  }

  io.emit(event, payload);
};

const emitContestUpdate = (contest) => {
  const contestId = String(contest?._id || contest?.id || contest?.contestId || '');
  if (!contestId) return;

  emit('contest:updated', { contestId, contest }, `contest:${contestId}`);
  emit('contest:listUpdated', { contestId, contest });
};

const emitLeaderboardUpdate = (contestId, leaderboard) => {
  if (!contestId) return;

  emit('leaderboard:updated', { contestId: String(contestId), leaderboard }, `contest:${contestId}`);
};

const emitResultDeclared = (contestId) => {
  if (!contestId) return;

  emit('result:declared', { contestId: String(contestId) }, `contest:${contestId}`);
};

module.exports = {
  emitContestUpdate,
  emitLeaderboardUpdate,
  emitResultDeclared,
  initRealtime,
};
