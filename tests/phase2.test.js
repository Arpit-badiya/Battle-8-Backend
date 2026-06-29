const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

jest.mock('firebase-admin', () => {
  const verifyIdToken = jest.fn();

  return {
    apps: [],
    credential: {
      applicationDefault: jest.fn(() => ({})),
      cert: jest.fn(() => ({})),
    },
    initializeApp: jest.fn(),
    auth: jest.fn(() => ({ verifyIdToken })),
    __verifyIdToken: verifyIdToken,
  };
});

const admin = require('firebase-admin');
const app = require('../app');
const Contest = require('../src/models/Contest');
const Player = require('../src/models/Player');
const Team = require('../src/models/Team');
const Transaction = require('../src/models/Transaction');
const User = require('../src/models/User');

let replSet;

const tokenFor = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });

const createUser = async (email, coins = 100, role = 'user') =>
  User.create({ email, coins, role });

const createPlayers = async () =>
  Player.insertMany(
    Array.from({ length: 8 }).map((_, index) => ({
      name: `Player ${index + 1}`,
      team: 'Team Alpha',
      credits: 8,
      role: ['IGL', 'Assaulter', 'Supporter'][index % 3],
    }))
  );

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
  });

  await mongoose.connect(replSet.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
  }
});

beforeEach(async () => {
  await Promise.all(
    mongoose.connection.modelNames().map((name) => mongoose.connection.model(name).deleteMany({}))
  );
});

test('Google login verifies Firebase token, creates user, and returns JWT', async () => {
  const email = 'google@example.com';
  admin.__verifyIdToken.mockResolvedValueOnce({
    email,
    email_verified: true,
    name: 'Google Player',
  });
  const success = await request(app)
    .post('/api/auth/google')
    .send({ firebaseIdToken: 'valid-firebase-token' })
    .expect(200);

  expect(success.body.token).toBeTruthy();
  expect(success.body.user._id).toBeTruthy();
  expect(success.body.user.email).toBe(email);
  expect(success.body.user.name).toBe('Google Player');
  expect(success.body.user.role).toBe('user');

  admin.__verifyIdToken.mockRejectedValueOnce(new Error('bad token'));

  await request(app)
    .post('/api/auth/google')
    .send({ firebaseIdToken: 'bad-firebase-token' })
    .expect(401);

  await User.create({ email: 'admin-login@example.com', role: 'admin', coins: 100 });
  admin.__verifyIdToken.mockResolvedValueOnce({
    email: 'admin-login@example.com',
    email_verified: true,
    name: 'Admin Player',
  });

  const adminLogin = await request(app)
    .post('/api/auth/google')
    .send({ firebaseIdToken: 'admin-firebase-token' })
    .expect(200);

  expect(adminLogin.body.user._id).toBeTruthy();
  expect(adminLogin.body.user.email).toBe('admin-login@example.com');
  expect(adminLogin.body.user.role).toBe('admin');
});

test('contest join deducts wallet once and duplicate retries do not double charge', async () => {
  const user = await createUser('join@example.com', 100);
  const players = await createPlayers();
  const contest = await Contest.create({
    title: 'Solo',
    players: 2,
    entryFee: 25,
    prizePool: 100,
    contestPlayers: players.map((player) => player._id),
    contestTeams: ['Team Alpha'],
  });
  await Team.create({
    user: user._id,
    contest: contest._id,
    players: players.slice(0, 5).map((player) => player._id),
    totalCredits: 40,
  });
  const token = tokenFor(user);

  await Promise.all([
    request(app)
      .post('/api/contests/join')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'join-test-key')
      .send({ contestId: contest._id }),
    request(app)
      .post('/api/contests/join')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'join-test-key')
      .send({ contestId: contest._id }),
  ]);

  const updatedUser = await User.findById(user._id).lean();
  const updatedContest = await Contest.findById(contest._id).lean();
  const transactions = await Transaction.find({ user: user._id, type: 'debit' }).lean();

  expect(updatedUser.coins).toBe(75);
  expect(updatedContest.joined).toBe(1);
  expect(updatedContest.participants).toHaveLength(1);
  expect(transactions).toHaveLength(1);
});

test('contest join rejects insufficient balance and does not consume slot', async () => {
  const user = await createUser('poor@example.com', 5);
  const players = await createPlayers();
  const contest = await Contest.create({
    title: 'Paid',
    players: 2,
    entryFee: 25,
    prizePool: 100,
    contestPlayers: players.map((player) => player._id),
    contestTeams: ['Team Alpha'],
  });
  await Team.create({
    user: user._id,
    contest: contest._id,
    players: players.slice(0, 5).map((player) => player._id),
    totalCredits: 40,
  });

  await request(app)
    .post('/api/contests/join')
    .set('Authorization', `Bearer ${tokenFor(user)}`)
    .send({ contestId: contest._id })
    .expect(400);

  const updatedContest = await Contest.findById(contest._id).lean();
  expect(updatedContest.joined).toBe(0);
  expect(updatedContest.participants).toHaveLength(0);
});

test('team validation rejects duplicate players and duplicate teams', async () => {
  const user = await createUser('team@example.com', 100);
  const players = await createPlayers();
  const contest = await Contest.create({
    title: 'Team Contest',
    players: 2,
    entryFee: 10,
    prizePool: 100,
    participants: [user._id],
    joined: 1,
    contestPlayers: players.map((player) => player._id),
  });
  const token = tokenFor(user);

  await request(app)
    .post('/api/team/create')
    .set('Authorization', `Bearer ${token}`)
    .send({
      contestId: contest._id,
      players: [players[0]._id, players[0]._id],
    })
    .expect(400);

  await request(app)
    .post('/api/team/create')
    .set('Authorization', `Bearer ${token}`)
    .send({
      contestId: contest._id,
      players: players.slice(0, 8).map((player) => player._id),
      captain: players[0]._id,
      viceCaptain: players[1]._id,
    })
    .expect(201);

  await request(app)
    .post('/api/team/create')
    .set('Authorization', `Bearer ${token}`)
    .send({
      contestId: contest._id,
      players: players.slice(0, 8).map((player) => player._id),
      captain: players[0]._id,
      viceCaptain: players[1]._id,
    })
    .expect(409);
});

test('leaderboard ranking is deterministic with ties', async () => {
  const [userA, userB, userC] = await Promise.all([
    createUser('a@example.com'),
    createUser('b@example.com'),
    createUser('c@example.com'),
  ]);
  const players = await createPlayers();
  const contest = await Contest.create({
    title: 'Leaderboard',
    players: 3,
    entryFee: 0,
    prizePool: 0,
  });

  await Team.create([
    { user: userA._id, contest: contest._id, players, totalCredits: 64, points: 20 },
    { user: userB._id, contest: contest._id, players, totalCredits: 64, points: 20 },
    { user: userC._id, contest: contest._id, players, totalCredits: 64, points: 10 },
  ]);

  const response = await request(app)
    .get(`/api/leaderboard/${contest._id}`)
    .set('Authorization', `Bearer ${tokenFor(userA)}`)
    .expect(200);

  expect(response.body.leaderboard.map((row) => row.rank)).toEqual([1, 1, 3]);
});

test('admin routes are protected and refunds are idempotent', async () => {
  const user = await createUser('refund-user@example.com', 50);
  const admin = await createUser('admin@example.com', 100, 'admin');
  const contest = await Contest.create({
    title: 'Refundable',
    players: 2,
    joined: 1,
    entryFee: 25,
    prizePool: 100,
    status: 'cancelled',
    participants: [user._id],
  });

  await Transaction.create({
    user: user._id,
    contest: contest._id,
    type: 'debit',
    amount: 25,
    reason: 'Contest entry: Refundable',
    balanceAfter: 25,
    idempotencyKey: `contest:${contest._id}:user:${user._id}`,
  });

  await request(app).get('/api/admin/dashboard').expect(401);

  await request(app)
    .post(`/api/admin/contests/${contest._id}/refund`)
    .set('Authorization', `Bearer ${tokenFor(admin)}`)
    .expect(200);

  await request(app)
    .post(`/api/admin/contests/${contest._id}/refund`)
    .set('Authorization', `Bearer ${tokenFor(admin)}`)
    .expect(200);

  const updatedUser = await User.findById(user._id).lean();
  const refunds = await Transaction.find({ user: user._id, type: 'credit' }).lean();

  expect(updatedUser.coins).toBe(75);
  expect(refunds).toHaveLength(1);
});

test('admin can delete a team and associated active players safely', async () => {
  const admin = await createUser('team-delete-admin@example.com', 100, 'admin');
  const alphaPlayers = await Player.insertMany(
    Array.from({ length: 3 }).map((_, index) => ({
      game: 'BGMI',
      name: `Alpha ${index + 1}`,
      team: 'Team Alpha',
      credits: 8,
      role: 'Assaulter',
    }))
  );
  const [betaPlayer] = await Player.create([
    {
      game: 'BGMI',
      name: 'Beta 1',
      team: 'Team Beta',
      credits: 8,
      role: 'Supporter',
    },
  ]);

  const contest = await Contest.create({
    title: 'Upcoming Team Delete',
    players: 10,
    entryFee: 0,
    prizePool: 0,
    game: 'BGMI',
    contestTeams: ['Team Alpha', 'Team Beta'],
    contestPlayers: [...alphaPlayers.map((player) => player._id), betaPlayer._id],
  });

  const response = await request(app)
    .delete('/api/players/team')
    .set('Authorization', `Bearer ${tokenFor(admin)}`)
    .send({ game: 'BGMI', team: 'Team Alpha' })
    .expect(200);

  expect(response.body.deletedPlayers).toBe(3);

  const activeAlpha = await Player.find({ game: 'BGMI', team: 'Team Alpha', active: true }).lean();
  const inactiveAlpha = await Player.find({ game: 'BGMI', team: 'Team Alpha', active: false }).lean();
  const activeBeta = await Player.find({ game: 'BGMI', team: 'Team Beta', active: true }).lean();
  const updatedContest = await Contest.findById(contest._id).lean();

  expect(activeAlpha).toHaveLength(0);
  expect(inactiveAlpha).toHaveLength(3);
  expect(activeBeta).toHaveLength(1);
  expect(updatedContest.contestTeams).toEqual(['Team Beta']);
  expect(updatedContest.contestPlayers.map(String)).toEqual([String(betaPlayer._id)]);
});
