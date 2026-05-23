const DEFAULT_COMMISSION_PERCENT = 10;
const MAX_COMMISSION_PERCENT = 50;

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

const buildPrizeWeights = (winnerCount) => {
  const count = Math.max(0, Math.min(Number(winnerCount || 0), 10));

  if (count === 0) return [];
  if (count <= 3) {
    return [
      { rank: 1, weight: 40 },
      { rank: 2, weight: 25 },
      { rank: 3, weight: 15 },
    ].slice(0, count);
  }

  const weights = [
    { rank: 1, weight: 40 },
    { rank: 2, weight: 25 },
    { rank: 3, weight: 15 },
  ];
  const lowerRankWeight = 20 / (count - 3);

  for (let rank = 4; rank <= count; rank += 1) {
    weights.push({ rank, weight: lowerRankWeight });
  }

  return weights;
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

  const totalCollection = toMoney(safeEntryFee * safeTotalSpots);
  const platformCommissionAmount = toMoney((totalCollection * commissionPercent) / 100);
  const prizePool = toMoney(totalCollection - platformCommissionAmount);

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

const splitRemainingByRanks = (cents, startRank, endRank) => {
  const count = endRank - startRank + 1;
  const base = Math.floor(cents / count);
  const remainder = cents % count;

  return Array.from({ length: count }).map((_, index) => ({
    rank: startRank + index,
    amount: (base + (index < remainder ? 1 : 0)) / 100,
  }));
};

const calculatePrizeDistribution = ({ prizePool, winnerCount }) => {
  const count = Math.max(0, Math.min(Number(winnerCount || 0), 10));
  const totalCents = Math.round(toMoney(prizePool) * 100);

  if (count === 0 || totalCents <= 0) {
    return [];
  }

  if (count <= 3) {
    return splitByWeights(toMoney(prizePool), buildPrizeWeights(count))
      .filter((item) => item.amount > 0);
  }

  const rank1 = Math.round(totalCents * 0.4);
  const rank2 = Math.round(totalCents * 0.25);
  const rank3 = Math.round(totalCents * 0.15);
  const remaining = Math.max(totalCents - rank1 - rank2 - rank3, 0);

  return [
    { rank: 1, amount: rank1 / 100 },
    { rank: 2, amount: rank2 / 100 },
    { rank: 3, amount: rank3 / 100 },
    ...splitRemainingByRanks(remaining, 4, count),
  ].filter((item) => item.amount > 0);
};

module.exports = {
  DEFAULT_COMMISSION_PERCENT,
  MAX_COMMISSION_PERCENT,
  calculateContestAccounting,
  calculatePrizeDistribution,
};
