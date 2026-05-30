const placementPointsMap = {
  1: 20,
  2: 14,
  3: 10,
  4: 8,
  5: 6,
  6: 4,
  7: 2,
};

const CAPTAIN_TEAM_MULTIPLIER = 2;
const VICE_CAPTAIN_TEAM_MULTIPLIER = 1.5;
const TEAM_CONTEST_SELECTED_TEAMS = 8;

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

/**
 * Calculate total points for a team-contest entry.
 * playerResults: [{ player (id), kills, placement, points, active, team (name) }]
 * selectedTeams: string[] — the 8 chosen team names
 * captainTeam: string — gets CAPTAIN_TEAM_MULTIPLIER applied to that team's aggregate
 * viceCaptainTeam: string — gets VICE_CAPTAIN_TEAM_MULTIPLIER applied
 */
const calculateTeamContestPoints = ({ playerResults = [], selectedTeams = [], captainTeam = '', viceCaptainTeam = '' }) => {
  const selectedSet = new Set(selectedTeams.map((t) => String(t).trim()));

  // Aggregate raw points per team name
  const teamPoints = {};
  for (const result of playerResults) {
    const teamName = String(result.team || '').trim();
    if (!selectedSet.has(teamName)) continue;
    if (!result.active) continue;
    teamPoints[teamName] = (teamPoints[teamName] || 0) + Number(result.points || 0);
  }

  let total = 0;
  for (const [teamName, pts] of Object.entries(teamPoints)) {
    let multiplier = 1;
    if (teamName === String(captainTeam).trim()) multiplier = CAPTAIN_TEAM_MULTIPLIER;
    else if (teamName === String(viceCaptainTeam).trim()) multiplier = VICE_CAPTAIN_TEAM_MULTIPLIER;
    total += pts * multiplier;
  }

  return Math.round(total * 100) / 100;
};

/**
 * Calculate total points for a team-contest entry using direct team-level results.
 * teamResults: [{ teamName, position, totalKills, points }]
 *   where points = totalKills * 4 + placementPoints[position]
 * selectedTeams: string[] — the 8 chosen team names
 * captainTeam: string — gets CAPTAIN_TEAM_MULTIPLIER applied
 * viceCaptainTeam: string — gets VICE_CAPTAIN_TEAM_MULTIPLIER applied
 */
const calculateTeamContestPointsDirect = ({ teamResults = [], selectedTeams = [], captainTeam = '', viceCaptainTeam = '' }) => {
  const selectedSet = new Set(selectedTeams.map((t) => String(t).trim()));
  const pointsByTeam = new Map(
    teamResults.map((r) => [String(r.teamName || '').trim(), Number(r.points || 0)])
  );

  let total = 0;
  for (const teamName of selectedSet) {
    const pts = pointsByTeam.get(teamName) || 0;
    let multiplier = 1;
    if (teamName === String(captainTeam).trim()) multiplier = CAPTAIN_TEAM_MULTIPLIER;
    else if (teamName === String(viceCaptainTeam).trim()) multiplier = VICE_CAPTAIN_TEAM_MULTIPLIER;
    total += pts * multiplier;
  }

  return Math.round(total * 100) / 100;
};

module.exports = {
  CAPTAIN_TEAM_MULTIPLIER,
  VICE_CAPTAIN_TEAM_MULTIPLIER,
  TEAM_CONTEST_SELECTED_TEAMS,
  calculatePlayerPoints,
  calculatePoints,
  calculateTeamContestPoints,
  calculateTeamContestPointsDirect,
  getPlacementPoints,
  validateResultInput,
};
