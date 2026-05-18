import PropTypes from 'prop-types';
import { Button, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

export const ConfirmDialog = ({
  show,
  title,
  body,
  confirmLabel = null,
  confirmVariant = 'danger',
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation(['common']);
  return (
    <Modal show={show} onHide={onCancel}>
      <Modal.Header closeButton>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{body}</Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          {t('common:buttons.cancel', 'Cancel')}
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm}>
          {confirmLabel ?? t('common:buttons.confirm', 'Confirm')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

ConfirmDialog.propTypes = {
  show: PropTypes.bool.isRequired,
  title: PropTypes.string.isRequired,
  body: PropTypes.node.isRequired,
  confirmLabel: PropTypes.string,
  confirmVariant: PropTypes.string,
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
