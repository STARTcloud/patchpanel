import { Cron } from 'croner';

export const nextRunAt = (cronExpression, from = new Date()) => {
  const cron = new Cron(cronExpression, { paused: true });
  const next = cron.nextRun(from);
  if (!next) {
    throw new Error(`cron expression has no future occurrences: ${cronExpression}`);
  }
  return next;
};

export const nextRunEpochSeconds = (cronExpression, from = new Date()) =>
  Math.floor(nextRunAt(cronExpression, from).getTime() / 1000);
