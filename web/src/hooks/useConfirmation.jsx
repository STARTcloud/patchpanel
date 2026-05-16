import { useCallback, useRef, useState } from 'react';

import { ConfirmDialog } from '../components/ConfirmDialog.jsx';

const DEFAULT_CONFIG = Object.freeze({
  title: 'Are you sure?',
  body: '',
  confirmLabel: 'Confirm',
  confirmVariant: 'danger',
});

export const useConfirmation = () => {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const resolverRef = useRef(null);

  const confirm = useCallback(
    (next = {}) =>
      new Promise(resolve => {
        setConfig({ ...DEFAULT_CONFIG, ...next });
        setOpen(true);
        resolverRef.current = resolve;
      }),
    []
  );

  const finalize = result => {
    setOpen(false);
    const resolver = resolverRef.current;
    resolverRef.current = null;
    if (resolver) {
      resolver(result);
    }
  };

  const handleConfirm = useCallback(() => finalize(true), []);
  const handleCancel = useCallback(() => finalize(false), []);

  const ConfirmationDialog = () => (
    <ConfirmDialog
      show={open}
      title={config.title}
      body={config.body}
      confirmLabel={config.confirmLabel}
      confirmVariant={config.confirmVariant}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { confirm, ConfirmationDialog };
};
