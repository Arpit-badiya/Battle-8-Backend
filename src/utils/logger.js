const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = levels[process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')];

const serializeError = (error) => ({
  name: error?.name,
  message: error?.message,
  stack: process.env.NODE_ENV === 'production' ? undefined : error?.stack,
  code: error?.code,
  labels: typeof error?.errorLabels === 'object' ? error.errorLabels : undefined,
});

const write = (level, message, meta = {}) => {
  if (levels[level] > currentLevel) {
    return;
  }

  const payload = {
    level,
    message,
    time: new Date().toISOString(),
    ...meta,
  };

  if (payload.error instanceof Error) {
    payload.error = serializeError(payload.error);
  }

  const line = JSON.stringify(payload);

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
};

module.exports = {
  debug: (message, meta) => write('debug', message, meta),
  error: (message, meta) => write('error', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
};
