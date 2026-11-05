import WebSocket, { WebSocketServer } from 'ws';
import type { EmulatorLogLine } from './index.js';

export class LogBroadcaster {
    readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });

    constructor(private readonly onLog?: (line: EmulatorLogLine) => void, private readonly now = Date.now) {
        this.sockets.on('connection', socket => socket.on('error', () => {}));
    }

    send(level: number, data: string): void {
        const line = { ts: this.now() / 1000, level, data };
        const frame = JSON.stringify(line);
        for (const socket of this.sockets.clients) {
            if (socket.readyState !== WebSocket.OPEN) continue;
            if (socket.bufferedAmount > 1024 * 1024) socket.terminate();
            else socket.send(frame);
        }
        this.onLog?.(line);
    }

    disconnect(): void { for (const socket of this.sockets.clients) socket.terminate(); }

    async close(): Promise<void> {
        this.disconnect();
        await new Promise<void>(resolve => this.sockets.close(() => resolve()));
    }
}
