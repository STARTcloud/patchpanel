export const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;

export const HOSTNAME_REGEX = /^[a-zA-Z0-9*][a-zA-Z0-9.*-]{0,252}$/u;

export const ACL_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/u;

export const ADDR_PORT_REGEX = /^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):\d{1,5}$/u;

export const CERT_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;

export const SECTION_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]*$/u;

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export const NAME_REGEX = /^[a-zA-Z0-9._-]+$/u;

export const CIDR_REGEX = /^[0-9a-fA-F:.]+\/\d{1,3}$/u;

export const TENANT_ID_REGEX = /^[a-zA-Z0-9-]+$/u;

export const LUA_FN_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/u;

export const DURATION_REGEX = /^\d+(?:ms|s|m|h|d)$/u;
