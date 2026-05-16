export const parseArgs = (argv, schema) => {
  const result = {};
  for (const [key, spec] of Object.entries(schema)) {
    result[key] = spec.default;
  }
  const args = argv.slice(2);
  let i = 0;
  while (i < args.length) {
    const token = args[i];
    if (!token.startsWith('--')) {
      i += 1;
      continue;
    }
    const name = token.slice(2);
    const spec = schema[name];
    if (!spec) {
      throw new Error(`unknown flag: --${name}`);
    }
    if (spec.type === 'boolean') {
      result[name] = true;
      i += 1;
      continue;
    }
    if (i + 1 >= args.length) {
      throw new Error(`flag --${name} requires a value`);
    }
    const value = args[i + 1];
    if (spec.type === 'number') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed)) {
        throw new Error(`flag --${name} expects an integer; got: ${value}`);
      }
      result[name] = parsed;
    } else {
      result[name] = value;
    }
    i += 2;
  }
  return result;
};

export const exitOnError = err => {
  const message = err && err.message ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  if (err && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exitCode = 1;
};
