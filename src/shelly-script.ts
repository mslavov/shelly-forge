import { ShellyDeployer } from './shelly-deployer';
import { ScriptHashCache } from './script-hash-cache';

export class ShellyScript {
    constructor(public ip: string, private code: () => void, private enableOnBoot: boolean) {}

    async setDebug(enable: boolean): Promise<void> {
        const response = await fetch(`http://${this.ip}/rpc/`, {
            method: 'POST',
            body: JSON.stringify({
                id: 1,
                method: 'Sys.SetConfig',
                params: {
                    config: {
                        debug: {
                            websocket: {
                                enable: enable,
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

    async deploy(name: string): Promise<boolean> {
        const deployer = new ShellyDeployer(this.ip);
        const executableCode = `(${this.code.toString()})()`;

        // Check if code has changed
        if (!ScriptHashCache.hasChanged(executableCode, name)) {
            console.log(`Script ${name} unchanged, skipping deployment`);
            return false;
        }

        console.log(`Deploying script to ${this.ip} with name ${name}`);
        await deployer.deploy(name, executableCode, this.enableOnBoot);

        // Update hash after successful deployment
        ScriptHashCache.updateHash(executableCode, name);
        return true;
    }
}
