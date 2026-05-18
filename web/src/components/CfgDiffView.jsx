import { diffLines } from 'diff';
import PropTypes from 'prop-types';
import { useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

const LINE_BG = Object.freeze({
  added: 'var(--bs-success-bg-subtle, #d1e7dd)',
  removed: 'var(--bs-danger-bg-subtle, #f8d7da)',
  context: 'transparent',
});

const PREFIX_BG = Object.freeze({
  added: 'var(--bs-success-border-subtle, #a3cfbb)',
  removed: 'var(--bs-danger-border-subtle, #f1aeb5)',
  context: 'transparent',
});

const PREFIX_CHAR = Object.freeze({
  added: '+',
  removed: '-',
  context: ' ',
});

const chunkKind = chunk => {
  if (chunk.added) {
    return 'added';
  }
  if (chunk.removed) {
    return 'removed';
  }
  return 'context';
};

const splitLines = value => {
  const lines = value.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
};

const buildDiffRows = (oldText, newText) => {
  const chunks = diffLines(oldText ?? '', newText ?? '');
  const rows = [];
  let oldLine = 1;
  let newLine = 1;
  for (const chunk of chunks) {
    const kind = chunkKind(chunk);
    for (const line of splitLines(chunk.value)) {
      rows.push({
        kind,
        oldLine: kind === 'added' ? null : oldLine,
        newLine: kind === 'removed' ? null : newLine,
        content: line,
      });
      if (kind !== 'added') {
        oldLine += 1;
      }
      if (kind !== 'removed') {
        newLine += 1;
      }
    }
  }
  return rows;
};

const countChanges = rows => {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.kind === 'added') {
      added += 1;
    } else if (r.kind === 'removed') {
      removed += 1;
    }
  }
  return { added, removed };
};

const GUTTER_CELL_STYLE = Object.freeze({
  textAlign: 'right',
  paddingRight: '0.5rem',
  color: 'var(--bs-secondary-color)',
  userSelect: 'none',
});

const PREFIX_CELL_BASE = Object.freeze({
  textAlign: 'center',
  userSelect: 'none',
});

const CONTENT_CELL_STYLE = Object.freeze({
  margin: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  padding: '0 0.5rem',
  fontFamily: 'inherit',
});

const stableRowKey = row => {
  if (row.kind === 'removed') {
    return `r${row.oldLine}`;
  }
  if (row.kind === 'added') {
    return `a${row.newLine}`;
  }
  return `c${row.oldLine}-${row.newLine}`;
};

const DiffRow = ({ row }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: '4rem 4rem 1.5rem 1fr',
      background: LINE_BG[row.kind],
    }}
  >
    <span style={GUTTER_CELL_STYLE}>{row.oldLine ?? ''}</span>
    <span style={GUTTER_CELL_STYLE}>{row.newLine ?? ''}</span>
    <span style={{ ...PREFIX_CELL_BASE, background: PREFIX_BG[row.kind] }}>
      {PREFIX_CHAR[row.kind]}
    </span>
    <pre style={CONTENT_CELL_STYLE}>{row.content || ' '}</pre>
  </div>
);

DiffRow.propTypes = {
  row: PropTypes.shape({
    kind: PropTypes.oneOf(['added', 'removed', 'context']).isRequired,
    oldLine: PropTypes.number,
    newLine: PropTypes.number,
    content: PropTypes.string.isRequired,
  }).isRequired,
};

const NoChangesMessage = ({ leftLabel, rightLabel }) => {
  const { t } = useTranslation(['state']);
  return (
    <div className="bg-body-tertiary border rounded patchpanel-fullheight-scroller d-flex align-items-center justify-content-center text-center text-muted p-5">
      <div>
        <i className="bi bi-check-circle text-success" style={{ fontSize: '2rem' }} />
        <div className="mt-2">
          <strong>{t('state:diff.noChanges', 'No changes.')}</strong>
        </div>
        <div className="small mt-1">
          <Trans
            i18nKey="state:diff.identical"
            t={t}
            defaults="<0>{{leftLabel}}</0> and <1>{{rightLabel}}</1> are identical — clicking Apply wouldn't change the file."
            values={{ leftLabel, rightLabel }}
            components={[<code key="0" />, <code key="1" />]}
          />
        </div>
      </div>
    </div>
  );
};

NoChangesMessage.propTypes = {
  leftLabel: PropTypes.string.isRequired,
  rightLabel: PropTypes.string.isRequired,
};

export const CfgDiffView = ({ oldText, newText, leftLabel = null, rightLabel = null }) => {
  const { t } = useTranslation(['state']);
  const resolvedLeft = leftLabel ?? t('state:diff.onDisk', 'on-disk');
  const resolvedRight = rightLabel ?? t('state:diff.fromState', 'from state');
  const rows = useMemo(() => buildDiffRows(oldText, newText), [oldText, newText]);
  const { added, removed } = useMemo(() => countChanges(rows), [rows]);
  if (rows.length === 0) {
    return (
      <div className="text-muted p-3">{t('state:diff.noContent', 'No content to compare.')}</div>
    );
  }
  if (added === 0 && removed === 0) {
    return <NoChangesMessage leftLabel={resolvedLeft} rightLabel={resolvedRight} />;
  }
  return (
    <div
      className="bg-body-tertiary border rounded patchpanel-fullheight-scroller"
      style={{
        fontSize: '0.78rem',
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      }}
    >
      <div
        className="px-3 py-2 border-bottom small d-flex gap-3 align-items-center"
        style={{
          position: 'sticky',
          top: 0,
          background: 'var(--bs-tertiary-bg)',
          zIndex: 1,
        }}
      >
        <span className="text-success fw-semibold">+{added}</span>
        <span className="text-danger fw-semibold">-{removed}</span>
        <span className="text-muted ms-auto">
          <Trans
            i18nKey="state:diff.comparing"
            t={t}
            defaults="comparing: <0>{{leftLabel}}</0> → <1>{{rightLabel}}</1>"
            values={{ leftLabel: resolvedLeft, rightLabel: resolvedRight }}
            components={[<code key="0" />, <code key="1" />]}
          />
        </span>
      </div>
      {rows.map(row => (
        <DiffRow key={stableRowKey(row)} row={row} />
      ))}
    </div>
  );
};

CfgDiffView.propTypes = {
  oldText: PropTypes.string,
  newText: PropTypes.string,
  leftLabel: PropTypes.string,
  rightLabel: PropTypes.string,
};
