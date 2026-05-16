import PropTypes from 'prop-types';

// State shape is owned by `server/src/lib/state-schema.js` (zod authoritative).
export const stateDocShape = PropTypes.object;

export const onSavePropType = PropTypes.func;
