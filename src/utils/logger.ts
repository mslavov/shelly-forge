import * as fs from 'fs';
import * as path from 'path';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), '.shelly-forge', 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Create log file paths
const logFile = path.join(logsDir, 'console.log');

// Create or append to log files
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

// Format messages with timestamp
const formatMessage = (message: string): string => {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] ${message}\n`;
};

let enableConsole = true;

// Logger functions
export const logger = {
    enableConsole: (enable: boolean): void => {
        enableConsole = enable;
    },

    log: (message: string): void => {
        // Write to console and file
        if (enableConsole) {
            console.log(message);
        }
        logStream.write(formatMessage(message));
    },

    debug: (message: string): void => {
        // Write to console and file with DEBUG prefix
        if (enableConsole) {
            console.log(`DEBUG: ${message}`);
        }
        logStream.write(formatMessage(`DEBUG: ${message}`));
    },

    error: (message: string, error?: any): void => {
        // Format error if provided
        let errorMsg = message;
        if (error) {
            if (error instanceof Error) {
                errorMsg += `: ${error.message}`;
                if (error.stack) {
                    errorMsg += `\n${error.stack}`;
                }
            } else {
                errorMsg += `: ${JSON.stringify(error)}`;
            }
        }

        // Write to console and file
        if (enableConsole) {
            console.error(errorMsg);
        }
        logStream.write(formatMessage(errorMsg));
    },

    // Close log streams on process exit
    close: (): void => {
        logStream.end();
    }
};

// Handle process exit to close log streams
process.on('exit', () => logger.close());
process.on('SIGINT', () => {
    logger.close();
    process.exit(0);
});
process.on('SIGTERM', () => {
    logger.close();
    process.exit(0);
});