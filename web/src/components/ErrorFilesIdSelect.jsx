import PropTypes from 'prop-types';
import { Form } from 'react-bootstrap';

// Shared dropdown for picking one of `state.httpErrorsSections[]` to bind
// via `errorfiles NAME`. Used by the DefaultsBlockEditModal and the
// per-frontend FrontendEditModal.

const renderHelpText = (sectionsEmpty, helpText) => {
  if (sectionsEmpty) {
    return (
      <Form.Text className="text-muted">
        No <code>http-errors</code> sections defined. Add one on the <strong>Error pages</strong>{' '}
        tab first.
      </Form.Text>
    );
  }
  if (helpText) {
    return <Form.Text className="text-muted">{helpText}</Form.Text>;
  }
  return null;
};

export const ErrorFilesIdSelect = ({ label, sections, value, onChange, helpText = null }) => (
  <Form.Group>
    <Form.Label>{label}</Form.Label>
    <Form.Select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      disabled={sections.length === 0}
    >
      <option value="">(none — use individual errorfile directives)</option>
      {sections.map(s => (
        <option key={s.id} value={s.id}>
          {s.name} ({s.id}) · {Object.keys(s.errorFiles ?? {}).length} files
        </option>
      ))}
    </Form.Select>
    {renderHelpText(sections.length === 0, helpText)}
  </Form.Group>
);

ErrorFilesIdSelect.propTypes = {
  label: PropTypes.string.isRequired,
  sections: PropTypes.array.isRequired,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  helpText: PropTypes.node,
};
