import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

export const APP_NAME = pkg.name;
export const APP_VERSION = pkg.version;
