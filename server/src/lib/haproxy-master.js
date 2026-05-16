import { createConnection } from 'node:net';

import { ReloadError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 30_000;

const sendCommand = (socketPath, command, timeoutMs) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy(new Error(`master socket timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once('connect', () => {
      socket.write(`${command}\n`);
    });
    socket.on('data', chunk => {
      chunks.push(chunk);
    });
    socket.once('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    socket.once('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });

export const reload = async (socketPath, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const output = await sendCommand(socketPath, 'reload', timeoutMs);
  if (/\[ALERT\]|\[EMERG\]|\bfailed\b/iu.test(output)) {
    throw new ReloadError(`HAProxy reported reload failure: ${output.trim()}`);
  }
  return output;
};

export const status = (socketPath, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) =>
  sendCommand(socketPath, 'status', timeoutMs);
