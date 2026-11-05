import type { Command } from 'commander';
import { register as init } from './init.js';
import { register as create } from './create.js';
import { register as build } from './build.js';
import { register as check } from './check.js';
import { register as deploy } from './deploy.js';
import { register as dev } from './dev.js';
import { register as status } from './status.js';
import { register as logs } from './logs.js';
import { register as debug } from './debug.js';
import { register as rpc } from './rpc.js';
import { register as evaluate } from './eval.js';
import { register as discover } from './discover.js';
import { register as skills } from './skills.js';
import { register as emulate } from './emulate.js';

export const ALL_COMMANDS: ReadonlyArray<(program: Command) => void> = [
    init, create, build, check, deploy, dev, status, logs, debug, rpc, evaluate, discover, skills, emulate,
];
