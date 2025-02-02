import axios from 'axios';

export class ShellyDevice {
    private readonly SYMBOLS_IN_CHUNK = 1024;

    constructor(private ip: string) {}

    async setDebug(enable: boolean): Promise<void> {
        try {
            const response = await axios.post(`http://${this.ip}/rpc`, {
                id: 1,
                method: 'Sys.SetConfig',
                params: {
                    config: {
                        debug: {
                            websocket: {
                                enable,
                            },
                        },
                    },
                },
            });
            console.log(`Debug websocket ${enable ? 'enabled' : 'disabled'}`);
        } catch (error) {
            console.error('Error setting debug mode:', error);
            throw error;
        }
    }

    private async putChunk(scriptId: string, code: string, append: boolean = false): Promise<void> {
        try {
            const response = await axios.post(
                `http://${this.ip}/rpc/Script.PutCode`,
                {
                    id: scriptId,
                    code,
                    append,
                },
                { timeout: 2000 }
            );
            console.log('Chunk uploaded:', response.data);
        } catch (error) {
            console.error('Error uploading chunk:', error);
            throw error;
        }
    }

    async listScripts(): Promise<any[]> {
        try {
            const response = await axios.post(`http://${this.ip}/rpc`, {
                id: 1,
                method: 'Script.List',
            });
            console.log('Scripts:', response.data);
            return response.data.result.scripts;
        } catch (error) {
            console.warn('Error listing scripts:', error);
            throw error;
        }
    }

    async stopScript(scriptId: string): Promise<void> {
        try {
            await axios.post(`http://${this.ip}/rpc`, {
                id: 1,
                method: 'Script.Stop',
                params: { id: scriptId },
            });
        } catch (error) {
            console.warn('Error stopping script:', error);
            console.log('Script may not be running');
        }
    }

    private async createScript(name: string): Promise<any> {
        const response = await axios.post(`http://${this.ip}/rpc`, {
            id: 1,
            method: 'Script.Create',
            params: { name },
        });
        return {
            id: response.data.result.id,
            name,
            enabled: false,
            running: false,
        };
    }

    private async setConfig(scriptId: string, name: string, enableOnBoot: boolean): Promise<void> {
        await axios.post(`http://${this.ip}/rpc`, {
            id: 1,
            method: 'Script.SetConfig',
            params: { id: scriptId, name, enable: enableOnBoot },
        });
    }

    /**
     * Deploy a script to a Shelly device.
     * @param name - The name of the script.
     * @param code - The code of the script.
     * @param enableOnBoot - Whether to enable the script on boot.
     */
    async deploy(name: string, code: string, enableOnBoot: boolean): Promise<void> {
        try {
            const scripts = await this.listScripts();
            let script = scripts.find((script: any) => script.name === name);
            if (!script) {
                script = await this.createScript(name);
            }
            await this.setConfig(script.id, name, enableOnBoot);
            if (script.running) {
                console.log(`Script ${name} already exists, stopping it`);
                await this.stopScript(script.id);
            }

            console.log(`Uploading ${code.length} bytes`);

            // Upload in chunks
            for (let pos = 0; pos < code.length; pos += this.SYMBOLS_IN_CHUNK) {
                const chunk = code.slice(pos, pos + this.SYMBOLS_IN_CHUNK);
                await this.putChunk(script.id, chunk, pos > 0);
            }

            console.log('Script uploaded successfully');

            // Restart script
            await axios.post(`http://${this.ip}/rpc`, {
                id: 1,
                method: 'Script.Start',
                params: { id: script.id },
            });
            console.log('Script restarted');
        } catch (error) {
            console.error('Error:', error);
            throw error;
        }
    }
}
