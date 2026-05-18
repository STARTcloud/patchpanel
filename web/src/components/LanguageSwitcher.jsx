import { NavDropdown } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

// Locale labels come from the browser's Intl.DisplayNames API — drop a new
// `<lng>/*.json` set under public/locales and the dropdown picks up the
// native-script name automatically (日本語, العربية, …) with no JS change.
// The names are themselves locale-aware: when the UI is in Spanish, other
// languages render in Spanish too ("Inglés" instead of "English").
const labelFor = (code, uiLocale) => {
  if (code === 'cimode') {
    return 'CI mode';
  }
  try {
    const display = new Intl.DisplayNames([uiLocale, code], { type: 'language' });
    const name = display.of(code);
    if (!name) {
      return code.toUpperCase();
    }
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return code.toUpperCase();
  }
};

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
          <span>{labelFor(code, current)}</span>
        </NavDropdown.Item>
      ))}
    </NavDropdown>
  );
};
