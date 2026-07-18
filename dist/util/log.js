// Minimal logger.
let silent = false;
export const setSilent = (s) => { silent = s; };
export const log = (...args) => {
    if (silent)
        return;
    // eslint-disable-next-line no-console
    console.log(...args);
};
export const info = (...args) => {
    if (silent)
        return;
    // eslint-disable-next-line no-console
    console.log(...args);
};
export const warn = (...args) => {
    // eslint-disable-next-line no-console
    console.error('warn:', ...args);
};
export const error = (...args) => {
    // eslint-disable-next-line no-console
    console.error('error:', ...args);
};
//# sourceMappingURL=log.js.map