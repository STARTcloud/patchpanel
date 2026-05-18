import PropTypes from 'prop-types';
import { Form } from 'react-bootstrap';
import { Trans, useTranslation } from 'react-i18next';

// Shared dropdown for picking one of `state.httpErrorsSections[]` to bind
// via `errorfiles NAME`. Used by the DefaultsBlockEditModal and the
// per-frontend FrontendEditModal.

const HelpText = ({ sectionsEmpty, helpText }) => {
  const { t } = useTranslation(['config']);
  if (sectionsEmpty) {
    return (
      <Form.Text className="text-muted">
        <Trans
          i18nKey="config:errorPages.idSelect.noSections"
          t={t}
          defaults="No <0>http-errors</0> sections defined. Add one on the <1>Error pages</1> tab first."
          components={[<code key="0" />, <strong key="1" />]}
        />
      </Form.Text>
    );
  }
  if (helpText) {
    return <Form.Text className="text-muted">{helpText}</Form.Text>;
  }
  return null;
};

HelpText.propTypes = {
  sectionsEmpty: PropTypes.bool.isRequired,
  helpText: PropTypes.node,
};

export const ErrorFilesIdSelect = ({ label, sections, value, onChange, helpText = null }) => {
  const { t } = useTranslation(['config']);
  return (
    <Form.Group>
      <Form.Label>{label}</Form.Label>
      <Form.Select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        disabled={sections.length === 0}
      >
        <option value="">
          {t(
            'config:errorPages.idSelect.noneOption',
            '(none — use individual errorfile directives)'
          )}
        </option>
        {sections.map(s => (
          <option key={s.id} value={s.id}>
            {t('config:errorPages.idSelect.sectionOption', '{{name}} ({{id}}) · {{count}} files', {
              name: s.name,
              id: s.id,
              count: Object.keys(s.errorFiles ?? {}).length,
            })}
          </option>
        ))}
      </Form.Select>
      <HelpText sectionsEmpty={sections.length === 0} helpText={helpText} />
    </Form.Group>
  );
};

ErrorFilesIdSelect.propTypes = {
  label: PropTypes.string.isRequired,
  sections: PropTypes.array.isRequired,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  helpText: PropTypes.node,
};
