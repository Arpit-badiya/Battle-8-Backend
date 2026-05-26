const DEFAULT_COMMISSION_PERCENT = 10;
const MAX_COMMISSION_PERCENT = 50;
const DEFAULT_PAYOUT_WEIGHTS = [
  { rank: 1, weight: 50 },
  { rank: 2, weight: 30 },
  { rank: 3, weight: 20 },
];

const toMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const splitByWeights = (amount, weights) => {
  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
  let remainingCents = Math.round(Number(amount || 0) * 100);

  return weights.map((item, index) => {
    const isLast = index === weights.length - 1;
    const cents = isLast
      ? remainingCents
      : Math.floor((Math.round(Number(amount || 0) * 100) * item.weight) / totalWeight);
    remainingCents -= cents;

    return {
      rank: item.rank,
      amount: cents / 100,
    };
  });
};

const getDynamicContestAccounting = ({ entryFee, joined = 0, platformCommissionPercent = 0 }) => {
  const safeEntryFee = Number(entryFee || 0);
  const safeJoined = Number(joined || 0);
  const commissionPercent = Number(platformCommissionPercent || 0);
  const totalCollection = toMoney(safeEntryFee * safeJoined);
  const platformCommissionAmount = toMoney((totalCollection * commissionPercent) / 100);

  return {
    totalCollection,
    platformCommissionAmount,
    prizePool: totalCollection,
  };
};

const calculateContestAccounting = ({ entryFee, totalSpots, platformCommissionPercent }) => {
  const safeEntryFee = Number(entryFee || 0);
  const safeTotalSpots = Number(totalSpots || 0);
  const commissionPercent = Number(
    platformCommissionPercent ?? DEFAULT_COMMISSION_PERCENT
  );

  if (!Number.isFinite(safeEntryFee) || safeEntryFee < 0) {
    throw new Error('Entry fee must be greater than or equal to 0');
  }

  if (!Number.isInteger(safeTotalSpots) || safeTotalSpots <= 0) {
    throw new Error('Total spots must be a positive whole number');
  }

  if (
    !Number.isFinite(commissionPercent) ||
    commissionPercent < 0 ||
    commissionPercent > MAX_COMMISSION_PERCENT
  ) {
    throw new Error(`Platform commission must be between 0 and ${MAX_COMMISSION_PERCENT}%`);
  }

  const totalCollection = 0;
  const platformCommissionAmount = 0;
  const prizePool = 0;

  if (prizePool < 0) {
    throw new Error('Prize pool cannot be negative');
  }

  return {
    entryFee: safeEntryFee,
    totalSpots: safeTotalSpots,
    platformCommissionPercent: commissionPercent,
    totalCollection,
    platformCommissionAmount,
    prizePool,
  };
};

const calculatePrizeDistribution = ({ prizePool, winnerCount }) => {
  const count = Math.max(0, Math.min(Number(winnerCount || 0), 3));
  const totalCents = Math.round(toMoney(prizePool) * 100);

  if (count === 0 || totalCents <= 0) {
    return [];
  }

  return splitByWeights(toMoney(prizePool), DEFAULT_PAYOUT_WEIGHTS.slice(0, count))
    .filter((item) => item.amount > 0);
};

module.exports = {
  DEFAULT_COMMISSION_PERCENT,
  DEFAULT_PAYOUT_WEIGHTS,
  MAX_COMMISSION_PERCENT,
  calculateContestAccounting,
  calculatePrizeDistribution,
  getDynamicContestAccounting,
};
