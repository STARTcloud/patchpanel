import { NavDropdown } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

// Maps locale code → label shown in the dropdown. Add entries as we ship
// more translations; unknown locales fall back to the upper-cased code.
const LOCALE_LABELS = Object.freeze({
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ja: '日本語',
  zh: '中文',
  pt: 'Português',
  ru: 'Русский',
  it: 'Italiano',
  nl: 'Nederlands',
});

const labelFor = code => LOCALE_LABELS[code] ?? code.toUpperCase();

export const LanguageSwitcher = () => {
  const { i18n, t } = useTranslation('common');
  const supported = i18n.options?.supportedLngs ?? ['en'];
  const available = supported.filter(code => code !== 'cimode');

  if (available.length <= 1) {
    return null;
  }

  const current = i18n.resolvedLanguage ?? i18n.language ?? available[0];
  const title = t('language.select', 'Language');

  return (
    <NavDropdown
      id="language-switcher"
      align="end"
      menuVariant="dark"
      title={
        <span className="d-inline-flex align-items-center gap-1 text-light" title={title}>
          <i className="bi bi-translate" />
          <span className="text-uppercase small">{current}</span>
        </span>
      }
    >
      {available.map(code => (
        <NavDropdown.Item
          key={code}
          active={code === current}
          onClick={() => i18n.changeLanguage(code)}
          className="d-flex align-items-center gap-2"
        >
          <span className="text-uppercase small text-muted" style={{ minWidth: '2rem' }}>
            {code}
          </span>
          <span>{labelFor(code)}</span>
        </NavDropdown.Item>
      ))}
    </NavDropdown>
  );
};
