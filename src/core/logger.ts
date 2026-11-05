import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { styleText } from 'node:util';

export type LogLevel = 'quiet' | 'info' | 'verbose';

export interface Logger {
    info(message: string): void;
    success(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
}

export function createLogger(options: {
    level: LogLevel;
    color?: boolean;
    logFile?: string | null;
    stream?: NodeJS.WritableStream;
}): Logger {
    const stream = options.stream ?? process.stderr;
    const color = options.color !== false && (stream as NodeJS.WriteStream).isTTY === true && process.env.NO_COLOR === undefined;
    let opened = false;
    let fileDisabled = false;

    function writeFile(level: string, message: string): void {
        if (!options.logFile || fileDisabled) return;
        try {
            if (!opened) {
                const directory = path.dirname(options.logFile);
                if (!existsSync(path.resolve(directory, '../..', 'solutions.config.json'))) return;
                mkdirSync(directory, { recursive: true });
                if (existsSync(options.logFile) && statSync(options.logFile).size > 1024 * 1024) {
                    renameSync(options.logFile, `${options.logFile}.1`);
                }
                opened = true;
            }
            appendFileSync(options.logFile, `[${new Date().toISOString()}] ${level}: ${message}\n`, 'utf8');
        } catch {
            // A failed diagnostic sink must not prevent a command from reporting its result.
            fileDisabled = true;
        }
    }

    function write(level: string, message: string, visible: boolean, tint?: 'green' | 'yellow' | 'red'): void {
        writeFile(level, message);
        if (visible) stream.write(`${color && tint ? styleText(tint, message, { validateStream: false }) : message}\n`);
    }

    return {
        info: message => write('INFO', message, options.level !== 'quiet'),
        success: message => write('SUCCESS', message, options.level !== 'quiet', 'green'),
        warn: message => write('WARN', message, true, 'yellow'),
        error: message => write('ERROR', message, true, 'red'),
        debug: message => write('DEBUG', message, options.level === 'verbose'),
    };
}
