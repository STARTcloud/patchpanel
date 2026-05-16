import PropTypes from 'prop-types';
import { Modal } from 'react-bootstrap';

export const ExpandedChartModal = ({ show, title, onClose, children }) => (
  <Modal show={show} onHide={onClose} size="xl" fullscreen="lg-down" scrollable>
    <Modal.Header closeButton>
      <Modal.Title>{title}</Modal.Title>
    </Modal.Header>
    <Modal.Body style={{ minHeight: '70vh' }}>{children}</Modal.Body>
  </Modal>
);

ExpandedChartModal.propTypes = {
  show: PropTypes.bool.isRequired,
  title: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
};
