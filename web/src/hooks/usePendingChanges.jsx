import PropTypes from 'prop-types';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// Pending-changes context. Pages that mutate state via drag-reorder write the
// next state document here instead of calling onSave directly; the navbar
// shows an Apply / Discard pair until the user commits.
//
// Shape: `pending` is either `null` (nothing pending) or
// `{ label: string, doc: stateDoc }`. The doc is the complete next state to
// persist when the user clicks Apply; pages that fire other CRUD operations
// (edit / delete / clone / add) merge their change on top of pending.doc so
// reorders aren't lost.

const PendingChangesContext = createContext(null);

export const PendingChangesProvider = ({ children }) => {
  const [pending, setPendingState] = useState(null);

  const setPending = useCallback(next => {
    setPendingState(next);
  }, []);

  const clearPending = useCallback(() => {
    setPendingState(null);
  }, []);

  const value = useMemo(
    () => ({ pending, setPending, clearPending }),
    [pending, setPending, clearPending]
  );

  return <PendingChangesContext.Provider value={value}>{children}</PendingChangesContext.Provider>;
};

PendingChangesProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export const usePendingChanges = () => {
  const ctx = useContext(PendingChangesContext);
  if (!ctx) {
    throw new Error('usePendingChanges must be used inside a PendingChangesProvider');
  }
  return ctx;
};
