import PropTypes from 'prop-types';
import { Alert, Badge, Button, Modal, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

const stepVariant = (index, currentStep) => {
  if (index === currentStep) {
    return 'primary';
  }
  if (index < currentStep) {
    return 'success';
  }
  return 'secondary';
};

const StepIndicator = ({ labels, currentStep }) => (
  <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
    {labels.map((label, i) => (
      <div key={label} className="d-flex align-items-center gap-2">
        <Badge bg={stepVariant(i, currentStep)} className="d-inline-flex align-items-center gap-1">
          <span className="fw-semibold">{i + 1}</span>
          <span>{label}</span>
        </Badge>
        {i < labels.length - 1 ? <span className="text-muted small">›</span> : null}
      </div>
    ))}
  </div>
);

StepIndicator.propTypes = {
  labels: PropTypes.arrayOf(PropTypes.string).isRequired,
  currentStep: PropTypes.number.isRequired,
};

export const WizardShell = ({
  show,
  title,
  stepLabels,
  currentStep,
  canAdvance = true,
  saving = false,
  error = null,
  finishLabel = null,
  finishVariant = 'success',
  size = 'lg',
  onPrev = null,
  onNext = null,
  onFinish = null,
  onCancel,
  children,
}) => {
  const { t } = useTranslation(['common']);
  const isLast = currentStep === stepLabels.length - 1;
  return (
    <Modal show={show} onHide={onCancel} size={size} backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <StepIndicator labels={stepLabels} currentStep={currentStep} />
        {error ? (
          <Alert variant="danger" className="mb-3">
            {typeof error === 'string' ? error : error.message}
          </Alert>
        ) : null}
        <div>{children}</div>
      </Modal.Body>
      <Modal.Footer className="d-flex justify-content-between">
        <Button variant="outline-secondary" onClick={onCancel} disabled={saving}>
          {t('common:buttons.cancel', 'Cancel')}
        </Button>
        <div className="d-flex gap-2">
          {onPrev ? (
            <Button variant="outline-secondary" onClick={onPrev} disabled={saving}>
              <i className="bi bi-arrow-left me-1" />
              {t('common:buttons.back', 'Back')}
            </Button>
          ) : null}
          {isLast ? (
            <Button
              variant={finishVariant}
              onClick={onFinish}
              disabled={!canAdvance || saving || !onFinish}
            >
              {saving ? (
                <>
                  <Spinner as="span" animation="border" size="sm" />{' '}
                  <span>{t('common:wizard.working', 'Working…')}</span>
                </>
              ) : (
                <>
                  <i className="bi bi-check2-circle me-1" />
                  {finishLabel ?? t('common:wizard.finish', 'Finish')}
                </>
              )}
            </Button>
          ) : (
            <Button variant="primary" onClick={onNext} disabled={!canAdvance || saving || !onNext}>
              {t('common:buttons.next', 'Next')}
              <i className="bi bi-arrow-right ms-1" />
            </Button>
          )}
        </div>
      </Modal.Footer>
    </Modal>
  );
};

WizardShell.propTypes = {
  show: PropTypes.bool.isRequired,
  title: PropTypes.node.isRequired,
  stepLabels: PropTypes.arrayOf(PropTypes.string).isRequired,
  currentStep: PropTypes.number.isRequired,
  canAdvance: PropTypes.bool,
  saving: PropTypes.bool,
  error: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Error)]),
  finishLabel: PropTypes.string,
  finishVariant: PropTypes.string,
  size: PropTypes.string,
  onPrev: PropTypes.func,
  onNext: PropTypes.func,
  onFinish: PropTypes.func,
  onCancel: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
};
