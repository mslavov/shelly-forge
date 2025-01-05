class Shelly {
    private ip: string;

    hostname(ip: string): Shelly {
        this.ip = ip;
        return this;
    }

    script(code: () => void): ShellyScript {
        return new ShellyScript(this.ip, code);
    }
}

class ShellyScript {
    constructor(private ip: string, private code: () => void) {}

    enableDebug(): void {
        console.log('Enabling debug for', this.ip);
    }

    disableDebug(): void {
        console.log('Disabling debug for', this.ip);
    }
}

class ShellyDeployment {
    constructor(private ip: string, private code: () => void) {}

    async enableDebug(): Promise<void> {
        const response = await fetch(`http://${this.ip}/rpc/`, {
            method: 'POST',
            body: JSON.stringify({
                id: 1,
                method: 'Sys.SetConfig',
                params: {
                    config: {
                        debug: {
                            websocket: {
                                enable: true,
                            },
                        },
                    },
                },
            }),
        });

        if (!response.ok) {
            throw new Error('Failed to enable debug');
        }
        console.log('Debug websocket enabled');
    }

    async disableDebug(): Promise<void> {
        const response = await fetch(`http://${this.ip}/rpc`, {
            method: 'POST',
            body: JSON.stringify({
                id: 1,
                method: 'Sys.SetConfig',
                params: {
                    config: {
                        debug: {
                            websocket: {
                                enable: false,
                            },
                        },
                    },
                },
            }),
        });

        if (!response.ok) {
            throw new Error('Failed to disable debug');
        }
        console.log('Debug websocket disabled');
    }
}

// Usage would be:
const shelly = new Shelly();
shelly.hostname('192.168.1.82').script(() => {
    // Your script code here
});
