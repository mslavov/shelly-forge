import * as fs from 'fs';
import * as path from 'path';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Create log file paths
const logFile = path.join(logsDir, 'shelly-forge.log');
const errorLogFile = path.join(logsDir, 'shelly-forge-error.log');

// Create or append to log files
const logStream = fs.createWriteStream(logFile, { flags: 'a' });
const errorLogStream = fs.createWriteStream(errorLogFile, { flags: 'a' });

// Format messages with timestamp
const formatMessage = (message: string): string => {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] ${message}\n`;
};

// Logger functions
export const logger = {
    log: (message: string): void => {
        // Write to console and file
        console.log(message);
        logStream.write(formatMessage(message));
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
        console.error(errorMsg);
        errorLogStream.write(formatMessage(errorMsg));
    },

    // Close log streams on process exit
    close: (): void => {
        logStream.end();
        errorLogStream.end();
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