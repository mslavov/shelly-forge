import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

export type FakeLogMessage = string | Record<string, unknown>;

export interface FakeLogServerOptions {
    password?: string;
    rpcHost?: string;
    messages?: FakeLogMessage[];
    onConnection?(socket: WebSocket, count: number): void;
    challengeHeader?: string;
    omitUpgradeChallenge?: boolean;
    upgradeStatus?: number;
}

export interface FakeLogServer {
    host: string;
    readonly connectionCount: number;
    readonly challengeRequests: number;
    readonly connections: Set<WebSocket>;
    send(message: FakeLogMessage): void;
    dropConnections(): void;
    waitForConnections(count: number): Promise<void>;
    close(): Promise<void>;
}

export async function startFakeLogServer(options: FakeLogServerOptions = {}): Promise<FakeLogServer> {
    const realm = 'shelly-fake-log';
    const nonce = randomBytes(18).toString('hex');
    const challenge = options.challengeHeader ?? `Digest realm="${realm}", nonce="${nonce}", qop="auth", algorithm=SHA-256`;
    const events = new EventEmitter();
    const connections = new Set<WebSocket>();
    let connectionCount = 0;
    let challengeRequests = 0;
    let closed = false;
    const sockets = new WebSocketServer({ noServer: true });

    function authenticated(header: string | undefined): boolean {
        if (options.password === undefined) return true;
        if (!header?.startsWith('Digest ')) return false;
        const fields = Object.fromEntries([...header.matchAll(/(\w+)=(?:"((?:\\.|[^"\\])*)"|([^,\s]+))/g)]
            .map(match => [match[1], match[2]?.replace(/\\(.)/g, '$1') ?? match[3]]));
        if (fields.username !== 'admin' || fields.realm !== realm || fields.nonce !== nonce
            || fields.uri !== '/debug/log' || fields.qop !== 'auth' || fields.algorithm !== 'SHA-256'
            || !/^[a-f\d]{8}$/.test(fields.nc ?? '') || !/^[a-f\d]{64}$/.test(fields.response ?? '')) return false;
        const hash = (value: string) => createHash('sha256').update(value).digest('hex');
        const ha1 = hash(`admin:${realm}:${options.password}`);
        const expected = hash(`${ha1}:${nonce}:${fields.nc}:${fields.cnonce}:auth:${hash('GET:/debug/log')}`);
        return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(fields.response, 'hex'));
    }

    const server = createServer((req, res) => {
        if (options.rpcHost && req.url === '/rpc') {
            const proxy = httpRequest(`http://${options.rpcHost}/rpc`, { method: req.method, headers: req.headers }, response => {
                res.writeHead(response.statusCode ?? 500, response.headers);
                response.pipe(res);
            });
            proxy.on('error', () => res.writeHead(502).end());
            req.pipe(proxy);
            return;
        }
        if (req.url !== '/debug/log') {
            res.writeHead(404).end();
            return;
        }
        challengeRequests++;
        res.writeHead(options.password === undefined ? 426 : 401, { 'WWW-Authenticate': challenge }).end();
    });
    server.on('upgrade', (req, socket, head) => {
        if (req.url !== '/debug/log') {
            socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
            return;
        }
        if (options.upgradeStatus !== undefined) {
            socket.end(`HTTP/1.1 ${options.upgradeStatus} Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
            return;
        }
        if (!authenticated(req.headers.authorization)) {
            const header = options.omitUpgradeChallenge ? '' : `WWW-Authenticate: ${challenge}\r\n`;
            socket.end(`HTTP/1.1 401 Unauthorized\r\n${header}Connection: close\r\nContent-Length: 0\r\n\r\n`);
            return;
        }
        sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
    });
    sockets.on('connection', socket => {
        connections.add(socket);
        connectionCount++;
        socket.on('error', () => {});
        socket.once('close', () => connections.delete(socket));
        for (const message of options.messages ?? []) socket.send(typeof message === 'string' ? message : JSON.stringify(message));
        options.onConnection?.(socket, connectionCount);
        events.emit('connection');
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fake log server did not bind a TCP port');

    return {
        host: `127.0.0.1:${address.port}`,
        get connectionCount() { return connectionCount; },
        get challengeRequests() { return challengeRequests; },
        connections,
        send(message) {
            const data = typeof message === 'string' ? message : JSON.stringify(message);
            for (const socket of connections) if (socket.readyState === WebSocket.OPEN) socket.send(data);
        },
        dropConnections() {
            for (const socket of connections) socket.terminate();
        },
        async waitForConnections(count) {
            if (connectionCount >= count) return;
            await new Promise<void>((resolve, reject) => {
                const check = () => { if (connectionCount >= count) done(); };
                const done = (error?: Error) => {
                    clearTimeout(timer);
                    events.off('connection', check);
                    if (error) reject(error);
                    else resolve();
                };
                const timer = setTimeout(() => done(new Error(`Expected ${count} log connections, got ${connectionCount}`)), 5000);
                events.on('connection', check);
            });
        },
        async close() {
            if (closed) return;
            closed = true;
            for (const socket of connections) socket.terminate();
            await new Promise<void>(resolve => sockets.close(() => resolve()));
            await new Promise<void>((resolve, reject) => {
                server.close(error => error ? reject(error) : resolve());
                server.closeAllConnections();
            });
        },
    };
}
