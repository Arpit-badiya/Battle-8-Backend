const ExcelJS = require('exceljs');

const normalizeCell = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const normalizeKey = (value) => normalizeCell(value).toLowerCase();

const parseCsv = (text = '') => {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(normalizeCell(cell));
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(normalizeCell(cell));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(normalizeCell(cell));
  if (row.some(Boolean)) rows.push(row);
  return rows;
};

const rowsFromUpload = async ({ file, csvText }) => {
  if (file?.buffer) {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) return [];
      const rows = [];
      sheet.eachRow((row) => {
        const values = row.values.slice(1).map(normalizeCell);
        if (values.some(Boolean)) rows.push(values);
      });
      return rows;
    }

    return parseCsv(file.buffer.toString('utf8'));
  }

  return parseCsv(csvText || '');
};

const stripHeader = (rows, expected) => {
  if (!rows.length) return rows;
  const first = rows[0].map(normalizeKey).join('|');
  const hasHeader = expected.some((word) => first.includes(word));
  return hasHeader ? rows.slice(1) : rows;
};

const parsePlayerImport = async ({ file, csvText }) => {
  const rows = stripHeader(await rowsFromUpload({ file, csvText }), ['team', 'player', 'name']);
  const seen = new Set();
  const players = [];
  const errors = [];

  rows.forEach((row, index) => {
    const line = index + 1;
    const team = normalizeCell(row[0]);
    const name = normalizeCell(row[1]);
    const key = `${normalizeKey(team)}:${normalizeKey(name)}`;

    if (!team || !name) {
      errors.push({ line, message: 'Team name and player name are required' });
      return;
    }

    if (seen.has(key)) {
      errors.push({ line, message: `Duplicate player in file: ${team}, ${name}` });
      return;
    }

    seen.add(key);
    players.push({ team, name, line });
  });

  return { players, errors };
};

const parseResultImport = async ({ file, csvText }) => {
  const rows = stripHeader(await rowsFromUpload({ file, csvText }), ['player', 'kills', 'position', 'placement']);
  const seen = new Set();
  const results = [];
  const errors = [];

  rows.forEach((row, index) => {
    const line = index + 1;
    const name = normalizeCell(row[0]);
    const kills = Number(row[1]);
    const placement = Number(row[2]);
    const key = normalizeKey(name);

    if (!name) {
      errors.push({ line, message: 'Player name is required' });
      return;
    }

    if (seen.has(key)) {
      errors.push({ line, message: `Duplicate result in file: ${name}` });
      return;
    }

    if (!Number.isInteger(kills) || kills < 0) {
      errors.push({ line, message: 'Kills must be a whole number greater than or equal to 0' });
      return;
    }

    if (!Number.isInteger(placement) || placement < 1 || placement > 16) {
      errors.push({ line, message: 'Position must be between 1 and 16' });
      return;
    }

    seen.add(key);
    results.push({ name, kills, placement, line });
  });

  return { results, errors };
};

module.exports = {
  normalizeKey,
  parsePlayerImport,
  parseResultImport,
};
