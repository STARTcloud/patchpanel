const LEVELS = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  notice: 35,
  warning: 40,
  error: 50,
  fatal: 60,
});

let currentLevel = LEVELS.info;
let currentFormat = 'pretty';

export const setLogLevel = level => {
  const numeric = LEVELS[level];
  if (numeric === undefined) {
    throw new Error(`unknown log level: ${level}`);
  }
  currentLevel = numeric;
};

export const setLogFormat = format => {
  if (format !== 'pretty' && format !== 'json') {
    throw new Error(`unknown log format: ${format}`);
  }
  currentFormat = format;
};

const formatFields = fields => {
  if (!fields) {
    return '';
  }
  const parts = Object.entries(fields).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
};

const emit = (level, msg, fields) => {
  if (LEVELS[level] < currentLevel) {
    return;
  }
  const time = new Date().toISOString();
  if (currentFormat === 'json') {
    const record = fields ? { time, level, msg, ...fields } : { time, level, msg };
    process.stderr.write(`${JSON.stringify(record)}\n`);
    return;
  }
  process.stderr.write(`${time} [${level}] ${msg}${formatFields(fields)}\n`);
};

export const trace = (msg, fields) => emit('trace', msg, fields);
export const debug = (msg, fields) => emit('debug', msg, fields);
export const info = (msg, fields) => emit('info', msg, fields);
export const notice = (msg, fields) => emit('notice', msg, fields);
export const warning = (msg, fields) => emit('warning', msg, fields);
export const error = (msg, fields) => emit('error', msg, fields);
export const fatal = (msg, fields) => emit('fatal', msg, fields);
