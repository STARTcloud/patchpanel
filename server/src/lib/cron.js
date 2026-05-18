import { Cron } from 'croner';

import { ValidationError } from './errors.js';

export const nextRunAt = (cronExpression, from = new Date()) => {
  const cron = new Cron(cronExpression, { paused: true });
  const next = cron.nextRun(from);
  if (!next) {
    throw new ValidationError('cron.noFutureOccurrence', {
      message: `cron expression has no future occurrences: ${cronExpression}`,
      replacements: { expression: cronExpression },
    });
  }
  return next;
};

export const nextRunEpochSeconds = (cronExpression, from = new Date()) =>
  Math.floor(nextRunAt(cronExpression, from).getTime() / 1000);
