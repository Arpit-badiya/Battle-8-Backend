const placementPointsMap = {
  1: 20,
  2: 14,
  3: 10,
  4: 8,
  5: 6,
  6: 4,
  7: 2,
};

const validateResultInput = ({ kills = 0, placement = 0 } = {}) => {
  const safeKills = Number(kills);
  const safePlacement = Number(placement);

  if (!Number.isInteger(safeKills) || safeKills < 0) {
    return {
      valid: false,
      message: 'Kills must be a whole number greater than or equal to 0',
    };
  }

  if (!Number.isInteger(safePlacement) || safePlacement < 1 || safePlacement > 16) {
    return {
      valid: false,
      message: 'Placement must be between 1 and 16',
    };
  }

  return {
    valid: true,
    kills: safeKills,
    placement: safePlacement,
  };
};

const getPlacementPoints = (placement) =>
  placementPointsMap[Number(placement || 0)] || 0;

const calculatePlayerPoints = ({ kills = 0, placement = 0 } = {}) =>
  Number(kills || 0) * 4 + getPlacementPoints(placement);

const calculatePoints = (players = []) =>
  players.reduce((total, player) => total + calculatePlayerPoints(player), 0);

module.exports = {
  calculatePlayerPoints,
  calculatePoints,
  getPlacementPoints,
  validateResultInput,
};
