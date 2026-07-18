// Minimal logger.

let silent = false;

export const setSilent = (s: boolean): void => { silent = s; };

export const log = (...args: unknown[]): void => {
  if (silent) return;
  // eslint-disable-next-line no-console
  console.log(...args);
};

export const info = (...args: unknown[]): void => {
  if (silent) return;
  // eslint-disable-next-line no-console
  console.log(...args);
};

export const warn = (...args: unknown[]): void => {
  // eslint-disable-next-line no-console
  console.error('warn:', ...args);
};

export const error = (...args: unknown[]): void => {
  // eslint-disable-next-line no-console
  console.error('error:', ...args);
};
