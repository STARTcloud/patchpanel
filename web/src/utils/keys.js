let counter = 0;

export const genKey = () => `k${Date.now().toString(36)}-${(counter += 1).toString(36)}`;
