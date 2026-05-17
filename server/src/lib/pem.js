// Shared PEM block parsing. Uses indexOf scanning instead of regex with
// non-greedy quantifiers, which CodeQL flags as polynomial-ReDoS prone on
// pathological inputs (many `-----BEGIN …-----` markers). All callers
// already see input bounded by express.json's 1 MB body limit, but we
// enforce a hard cap here as defense-in-depth so a future caller can't
// accidentally feed an unbounded string in.

export const MAX_PEM_INPUT_BYTES = 2_000_000;

const findBlocks = (text, label) => {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_PEM_INPUT_BYTES) {
    return [];
  }
  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  const blocks = [];
  let cursor = 0;
  while (cursor < text.length) {
    const startIdx = text.indexOf(begin, cursor);
    if (startIdx === -1) {
      break;
    }
    const bodyStart = startIdx + begin.length;
    const endIdx = text.indexOf(end, bodyStart);
    if (endIdx === -1) {
      break;
    }
    blocks.push({
      block: text.slice(startIdx, endIdx + end.length),
      body: text.slice(bodyStart, endIdx),
    });
    cursor = endIdx + end.length;
  }
  return blocks;
};

export const findCertificatePemBlocks = text => findBlocks(text, 'CERTIFICATE');
export const findCrlPemBlocks = text => findBlocks(text, 'X509 CRL');
