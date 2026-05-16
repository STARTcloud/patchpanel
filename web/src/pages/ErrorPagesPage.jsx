import { Alert, Card } from 'react-bootstrap';

import { EntitySectionCard } from '../components/EntitySectionCard.jsx';
import { HTTP_ERRORS_SECTIONS_SECTION } from '../lib/section-configs.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

export const ErrorPagesPage = ({ doc = null, onSave = null }) => {
  if (!doc) {
    return null;
  }
  return (
    <>
      <Card className="mb-3">
        <Card.Body>
          <Card.Title>Error pages</Card.Title>
          <Card.Text className="text-muted small mb-0">
            Named <code>http-errors</code> sections that frontends and defaults blocks bind via{' '}
            <code>useErrorFilesId</code>. For per-status template content (the actual{' '}
            <code>.http</code> file bodies), edit each defaults block&apos;s <code>errorFiles</code>{' '}
            map on the <strong>Defaults</strong> page.
          </Card.Text>
        </Card.Body>
      </Card>
      {onSave ? (
        <EntitySectionCard doc={doc} onSave={onSave} section={HTTP_ERRORS_SECTIONS_SECTION} />
      ) : (
        <Alert variant="warning">State save unavailable.</Alert>
      )}
    </>
  );
};

ErrorPagesPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
