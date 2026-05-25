export const parseIntOrUndef = raw => {
  if (raw === '' || raw === null || raw === undefined) {
    return undefined;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) ? n : undefined;
};

export const formatTimestamp = value => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};
