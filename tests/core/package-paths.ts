import path from 'node:path';
import { PACKAGE_ROOT } from '../../src/core/paths.js';

export const TYPES_DIR = path.join(PACKAGE_ROOT, 'types');
export const SCHEMA_PATH = path.join(PACKAGE_ROOT, 'schema', 'solutions.config.schema.json');
