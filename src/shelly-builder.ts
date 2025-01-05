import { ShellyScript } from './shelly-script';

export class ShellyBuilder {
    private ip: string;
    private _enableOnBoot: boolean = true;

    hostname(ip: string): ShellyBuilder {
        this.ip = ip;
        return this;
    }

    enableOnBoot(enable: boolean): ShellyBuilder {
        this._enableOnBoot = enable;
        return this;
    }

    script(code: () => void): ShellyScript {
        return new ShellyScript(this.ip, code, this._enableOnBoot);
    }
}
