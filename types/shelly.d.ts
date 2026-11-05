type ShellyJsonValue = string | number | boolean | null | ShellyJsonValue[] | { [key: string]: ShellyJsonValue };
type ShellyEmptyParams = Record<string, never> | null;
type ShellyUserDataArgs<T> = undefined extends T ? [userdata?: T] : [userdata: T];

interface ShellyDeviceInfo {
  id: string;
  mac: string;
  model: string;
  gen: number;
  fw_id: string;
  ver: string;
  app: string;
  profile?: string;
  auth_en: boolean;
  auth_domain: string | null;
  discoverable?: boolean;
  provision?: 'pending' | 'confirmed' | 'complete' | 'locked';
  key?: string;
  batch?: string;
  fw_sbits?: string;
}

interface ShellySwitchStatus {
  id: number;
  source: string;
  output: boolean;
  tag?: string | null;
  timer_started_at?: number;
  timer_duration?: number;
  timer_type?: 'auto_on' | 'auto_off' | 'power_restore_delay' | 'toggle_after';
  apower?: number;
  voltage?: number;
  current?: number;
  pf?: number;
  freq?: number;
  aenergy?: { total: number; by_minute?: number[]; minute_ts?: number };
  ret_aenergy?: { total: number; by_minute?: number[]; minute_ts?: number };
  temperature?: { tC: number | null; tF: number | null };
  errors?: string[];
}

interface TemperatureStatus {
  id: number;
  tC: number | null;
  tF: number | null;
  errors?: string[];
}

interface ShellyInputStatus {
  id: number;
  state?: boolean | null;
  percent?: number | null;
  xpercent?: number | null;
  counts?: {
    total: number;
    xtotal?: number | null;
    by_minute?: number[];
    xby_minute?: number | null;
    minute_ts?: number;
  };
  freq?: number;
  xfreq?: number | null;
  errors?: string[];
}

interface ShellySysStatus {
  mac: string;
  restart_required: boolean;
  time: string | null;
  unixtime: number | null;
  last_sync_ts?: number | null;
  uptime: number;
  ram_size: number;
  ram_free: number;
  fs_size: number;
  fs_free: number;
  cfg_rev: number;
  kvs_rev?: number;
  schedule_rev?: number;
  webhook_rev?: number;
  available_updates: Record<string, { version: string; build_id?: string; nsteps?: number }>;
  reset_reason?: number;
  [key: string]: unknown;
}

interface ShellyScriptConfig {
  id: number;
  name: string;
  enable: boolean;
}

interface ShellyScriptStatus {
  id: number;
  running: boolean;
  mem_used?: number;
  mem_peak?: number;
  mem_free?: number;
  cpu?: number;
  errors?: string[];
}

interface ShellyKvsItem {
  etag: string;
  value: ShellyJsonValue;
}

interface ShellyHttpOptions {
  url: string;
  timeout?: number;
  ssl_ca?: null | 'user_ca.pem' | '*';
}

type ShellyHttpBody = { body: string; body_b64?: never } | { body?: never; body_b64: string };
type ShellyHttpRequest = ShellyHttpOptions & { headers?: Record<string, string> } & (
  | { method: 'GET' | 'HEAD'; body?: never; body_b64?: never }
  | ({ method: 'POST' | 'PUT' } & ShellyHttpBody)
  | { method: 'DELETE'; body?: string; body_b64?: never }
  | { method: 'DELETE'; body?: never; body_b64?: string }
);

interface ShellyHttpResponse {
  code: number;
  message: string;
  headers: Record<string, string>;
  body?: string;
  body_b64?: string;
}

/** Extend this interface to type additional firmware or component methods. */
interface ShellyRpcMethods {
  'Switch.Set': {
    params: { id: number; on: boolean; toggle_after?: number; tag?: string | null };
    result: { was_on: boolean };
  };
  'Switch.Toggle': { params: { id: number; tag?: string | null }; result: { was_on: boolean } };
  'Switch.GetStatus': { params: { id: number }; result: ShellySwitchStatus };
  'KVS.Get': { params: { key: string }; result: ShellyKvsItem };
  'KVS.Set': {
    params: { key: string; value: ShellyJsonValue; etag?: string };
    result: { etag: string; rev: number };
  };
  'KVS.GetMany': {
    params: { match?: string; offset?: number } | null;
    result: { items: Record<string, ShellyKvsItem>; offset: number; total: number };
  };
  'KVS.List': {
    params: { match?: string } | null;
    result: { keys: Record<string, { etag: string }>; rev: number };
  };
  'KVS.Delete': { params: { key: string; etag?: string }; result: { rev: number } };
  'HTTP.GET': { params: ShellyHttpOptions; result: ShellyHttpResponse };
  'HTTP.POST': {
    params: ShellyHttpOptions & ShellyHttpBody & { content_type?: string };
    result: ShellyHttpResponse;
  };
  'HTTP.Request': { params: ShellyHttpRequest; result: ShellyHttpResponse };
  'Temperature.GetStatus': { params: { id: number }; result: TemperatureStatus };
  'Input.GetStatus': { params: { id: number }; result: ShellyInputStatus };
  'Sys.GetStatus': { params: ShellyEmptyParams; result: ShellySysStatus };
  'Shelly.GetDeviceInfo': { params: { ident?: boolean } | null; result: ShellyDeviceInfo };
  'Script.GetConfig': { params: { id: number }; result: ShellyScriptConfig };
  'Script.SetConfig': {
    params: { id: number; config: Partial<Pick<ShellyScriptConfig, 'name' | 'enable'>> };
    result: { restart_required: boolean };
  };
  'Script.GetStatus': { params: { id: number }; result: ShellyScriptStatus };
  'Script.List': { params: ShellyEmptyParams; result: { scripts: (ShellyScriptConfig & { running: boolean })[] } };
  'Script.Create': { params: { name?: string } | null; result: { id: number } };
  'Script.Delete': { params: { id: number }; result: null };
  'Script.Start': { params: { id: number }; result: { was_running: boolean } };
  'Script.Stop': { params: { id: number }; result: { was_running: boolean } };
  'Script.PutCode': { params: { id: number; code: string; append?: boolean }; result: { len: number } };
  'Script.GetCode': { params: { id: number; offset?: number; len?: number }; result: { data: string; left: number } };
  'Script.Eval': { params: { id: number; code: string }; result: { result: string } };
}

interface ShellyEvent {
  component: string;
  name: string;
  id: number;
  info: {
    component?: string;
    id?: number;
    event: string;
    ts: number;
    data?: ShellyJsonValue;
    [key: string]: unknown;
  };
}

interface ShellyStatusEvent {
  component: string;
  name: string;
  id: number;
  delta: {
    output?: boolean;
    state?: boolean | null;
    apower?: number;
    tC?: number | null;
    tF?: number | null;
    running?: boolean;
    [key: string]: unknown;
  };
}

declare namespace Shelly {
  type RpcCallback<Result, UserData = undefined> = (
    result: Result | undefined,
    error_code: number,
    error_message: string,
    userdata: UserData
  ) => void;

  function call<M extends keyof ShellyRpcMethods, UserData = undefined>(
    method: M,
    params: ShellyRpcMethods[NoInfer<M>]['params'],
    callback?: RpcCallback<ShellyRpcMethods[NoInfer<M>]['result'], UserData>,
    ...userdata: ShellyUserDataArgs<UserData>
  ): void;
  function call<M extends string, UserData = undefined>(
    method: M extends keyof ShellyRpcMethods ? never : M,
    params: Record<string, unknown> | null,
    callback?: RpcCallback<unknown, UserData>,
    ...userdata: ShellyUserDataArgs<UserData>
  ): void;
  function addEventHandler<UserData = undefined>(
    callback: (event: ShellyEvent, userdata: UserData) => void,
    ...userdata: ShellyUserDataArgs<UserData>
  ): number;
  function addStatusHandler<UserData = undefined>(
    callback: (status: ShellyStatusEvent, userdata: UserData) => void,
    ...userdata: ShellyUserDataArgs<UserData>
  ): number;
  function removeEventHandler(handle: number): boolean | undefined;
  function removeStatusHandler(handle: number): boolean | undefined;
  function emitEvent(name: string, data: ShellyJsonValue): void;
  function getComponentConfig(type_or_key: string, id?: number): Record<string, unknown> | null;
  function getComponentStatus(type_or_key: 'switch' | `switch:${number}`, id?: number): ShellySwitchStatus | null;
  function getComponentStatus(type_or_key: 'temperature' | `temperature:${number}`, id?: number): TemperatureStatus | null;
  function getComponentStatus(type_or_key: 'input' | `input:${number}`, id?: number): ShellyInputStatus | null;
  function getComponentStatus(type_or_key: 'sys'): ShellySysStatus | null;
  function getComponentStatus(type_or_key: 'script' | `script:${number}`, id?: number): ShellyScriptStatus | null;
  function getComponentStatus(type_or_key: string, id?: number): Record<string, unknown> | null;
  function getDeviceInfo(): ShellyDeviceInfo;
  function getCurrentScriptId(): number;
  function getUptimeMs(): number;
}

declare namespace Script {
  const id: number;
  const storage: {
    readonly length: number;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    clear(): void;
    key(index: number): string | null;
  };
  function getVcHandle(role: string): Virtual | null;
}

declare namespace Virtual {
  function getHandle(key: string): Virtual | null;
}

interface Virtual {
  setValue(value: ShellyJsonValue): void;
  getValue(): ShellyJsonValue | undefined;
  getStatus(): Record<string, unknown> | undefined;
  getConfig(): Record<string, unknown> | undefined;
  setConfig(config: Record<string, unknown>): void;
  on(event: string, callback: (event: { source: unknown; value?: ShellyJsonValue }) => void): number;
  off(listener_id: number): void;
}

declare namespace MQTT {
  function isConnected(): boolean;
  function subscribe<UserData = undefined>(
    topic: string,
    callback: (topic: string, message: string, userdata: UserData) => void,
    ...userdata: ShellyUserDataArgs<UserData>
  ): void;
  function unsubscribe(topic: string): boolean;
  function publish(topic: string, message: string, qos?: 0 | 1 | 2, retain?: boolean): boolean;
  function setConnectHandler<UserData = undefined>(callback: (userdata: UserData) => void, ...userdata: ShellyUserDataArgs<UserData>): void;
  function setDisconnectHandler<UserData = undefined>(callback: (userdata: UserData) => void, ...userdata: ShellyUserDataArgs<UserData>): void;
}

declare namespace BLE {
  namespace Scanner {
    const SCAN_START: 0;
    const SCAN_STOP: 1;
    const SCAN_RESULT: 2;
    const INFINITE_SCAN: -1;

    interface ScanResult {
      addr: string;
      addr_type: number;
      advData: string;
      scanRsp: string;
      rssi: number;
      flags?: number;
      local_name?: string;
      manufacturer_data?: Record<number, string>;
      service_uuids?: string[];
      service_data?: Record<string, string>;
      tx_power_level?: number;
    }

    interface ScanFilter {
      addrs?: string[];
      name?: string;
      services?: string[];
      manufacturerData?: { companyIdentifier: number; dataPrefix?: string; mask?: string };
      serviceData?: { service: string; dataPrefix?: string; mask?: string };
    }

    interface ScanOptions {
      duration_ms?: number;
      active?: boolean;
      interval_ms?: number;
      window_ms?: number;
      rssi_thr?: number;
      filters?: ScanFilter[];
    }

    type ScanEvent =
      | [event: typeof SCAN_RESULT, result: ScanResult]
      | [event: typeof SCAN_START | typeof SCAN_STOP, result: null | undefined];
    type ScanCallback<UserData = undefined> = (...args: [...ScanEvent, userdata: UserData]) => void;

    function subscribe<UserData = undefined>(callback: ScanCallback<UserData> | null, ...userdata: ShellyUserDataArgs<UserData>): void;
    function start<UserData = undefined>(options: ScanOptions, callback?: ScanCallback<UserData>, ...userdata: ShellyUserDataArgs<UserData>): ScanOptions | null;
    function stop(): boolean;
    function isRunning(): boolean;
    function getScanOptions(): ScanOptions | null;
  }

  namespace GAP {
    const ADDRESS_TYPE_PUBLIC: 1;
    const ADDRESS_TYPE_RANDOM_STATIC: 2;
    const ADDRESS_TYPE_RANDOM_NON_RESOLVABLE: 3;
    const ADDRESS_TYPE_RANDOM_RESOLVABLE: 4;
    const EIR_FLAGS: 0x01;
    const EIR_SERVICE_16: 0x03;
    const EIR_SERVICE_128: 0x07;
    const EIR_SHORT_NAME: 0x08;
    const EIR_FULL_NAME: 0x09;
    const EIR_TX_POWER_LEVEL: 0x0a;
    const EIR_SERVICE_DATA_16: 0x16;
    const EIR_MANUFACTURER_SPECIFIC_DATA: 0xff;

    function parseName(data: string): string | null;
    function parseManufacturerData(data: string): Record<number, string> | null;
    function hasService(data: string, uuid: string): boolean;
    function parseServiceData(data: string, uuid: string): string | null;
  }
}

declare namespace HTTPServer {
  interface Request {
    method: string;
    query?: string;
    headers: [string, string][];
    body?: string;
  }

  interface Response {
    code?: number;
    body?: string;
    headers?: [string, string][];
    send(): boolean;
  }

  function registerEndpoint<UserData = undefined>(
    endpoint_name: string,
    callback: (request: Request, response: Response, userdata: UserData) => void,
    ...userdata: ShellyUserDataArgs<UserData>
  ): string;
}

declare namespace Timer {
  interface Info {
    interval: number;
    next: number;
  }

  function set<UserData = undefined>(
    period: number,
    repeat: boolean,
    callback: (userdata: UserData) => void,
    ...userdata: ShellyUserDataArgs<UserData>
  ): number;
  function clear(handle: number): boolean | undefined;
  function getInfo(handle: number): Info | undefined;
}

declare function btoh(value: string): string;
declare function print(...values: unknown[]): void;
