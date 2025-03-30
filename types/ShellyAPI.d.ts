// Shelly API
// Shelly API
declare namespace Shelly {
    /**
     * Invokes an RPC method on the local device.
     * @param method - Name of the method to invoke.
     * @param params - Parameters for the method.
     * @param callback - Optional callback invoked upon completion.
     * @param userdata - Optional user data passed to the callback.
     * @throws Throws an exception if arguments are invalid.
     */
    function call(
        method: string,
        params: object | string,
        callback?: (
            result: object | null | undefined,
            error_code: number,
            error_message: string,
            userdata?: any
        ) => void,
        userdata?: any
    ): void;

    /**
     * Adds an event handler for device events.
     * @param callback - Function invoked when an event occurs.
     * @param userdata - Optional user data passed to the callback.
     * @returns A subscription handle for the event handler.
     */
    function addEventHandler(callback: (event_data: object, userdata?: any) => void, userdata?: any): number;

    /**
     * Adds a status handler for device status changes.
     * @param callback - Function invoked when a status change occurs.
     * @param userdata - Optional user data passed to the callback.
     * @returns A subscription handle for the status handler.
     */
    function addStatusHandler(callback: (status_data: object, userdata?: any) => void, userdata?: any): number;

    /**
     * Removes an event handler.
     * @param subscription_handle - The handle of the event handler to remove.
     * @returns True if the handler was removed, false otherwise.
     */
    function removeEventHandler(subscription_handle: number): boolean;

    /**
     * Removes a status handler.
     * @param subscription_handle - The handle of the status handler to remove.
     * @returns True if the handler was removed, false otherwise.
     */
    function removeStatusHandler(subscription_handle: number): boolean;

    /**
     * Emits an event to all persistent RPC channels.
     * @param name - Name of the event.
     * @param data - Payload of the event. Must be a valid JSON value.
     * @throws Throws an exception if arguments are invalid.
     */
    function emitEvent(name: string, data: any): void;

    /**
     * Retrieves the configuration of a component.
     * @param type_or_key - Component type or key ("component:id").
     * @param id - Numeric ID for multi-instance components (optional).
     * @returns The component's configuration object, or null if not found.
     * @throws Throws an exception if arguments are invalid.
     */
    function getComponentConfig(type_or_key: string, id?: number): object | null;

    /**
     * Retrieves the status of a component.
     * @param type_or_key - Component type or key ("component:id").
     * @param id - Numeric ID for multi-instance components (optional).
     * @returns The component's status object, or null if not found.
     * @throws Throws an exception if arguments are invalid.
     */
    function getComponentStatus(type_or_key: string, id?: number): object | null;

    /**
     * Retrieves the device information.
     * @returns The DeviceInfo object.
     */
    function getDeviceInfo(): object;

    /**
     * Retrieves the ID of the current script.
     * @returns The ID of the current script.
     */
    function getCurrentScriptId(): number;

    /**
     * Retrieves the system uptime in milliseconds.
     * @returns The system uptime in milliseconds.
     */
    function getUptimeMs(): number;
}

/**
 * The ID of the running script instance.
 */
declare namespace Script {
    /**
     * The ID of the running script instance.
     */
    const id: number;

    /**
     * Storage interface for the script, similar to Web Storage API.
     * Each script has its own isolated storage.
     * - max key length: 16 bytes
     * - max value length: 1024 bytes
     * - max number of items: 12
     */
    const storage: {
        /**
         * Returns the number of key/value pairs in the storage.
         */
        readonly length: number;

        /**
         * Retrieves the value associated with the given key.
         * @param key - The key to retrieve.
         * @returns The value associated with the key, or null if the key does not exist.
         */
        getItem(key: string): string | null;

        /**
         * Sets the value for the given key.
         * @param key - The key to set.
         * @param value - The value to set.
         */
        setItem(key: string, value: string): void;

        /**
         * Removes the key/value pair with the given key.
         * @param key - The key to remove.
         */
        removeItem(key: string): void;

        /**
         * Removes all key/value pairs from storage.
         */
        clear(): void;

        /**
         * Returns the key at the specified index.
         * @param index - The index to retrieve the key from.
         * @returns The key at the specified index, or null if the index is out of range.
         */
        key(index: number): string | null;
    };
}

// Virtual Component API
declare namespace Virtual {
    /**
     * Retrieves a handle to a virtual component.
     * @param key - The key identifying the virtual component.
     * @returns An instance of Virtual or null on error.
     */
    function getHandle(key: string): Virtual | null;
}

interface Virtual {
    /**
     * Sets the value of the virtual component.
     * @param new_value - The new value to set.
     */
    setValue(new_value: any): void;

    /**
     * Retrieves the current value of the virtual component.
     * @returns The current value, or undefined on error.
     */
    getValue(): any;

    /**
     * Retrieves the status of the virtual component.
     * @returns The status object, or undefined if the component no longer exists.
     */
    getStatus(): object | undefined;

    /**
     * Retrieves the configuration of the virtual component.
     * @returns The configuration object, or undefined if the component no longer exists.
     */
    getConfig(): object | undefined;

    /**
     * Sets the configuration of the virtual component.
     * @param config_obj - The configuration object to set.
     */
    setConfig(config_obj: object): void;

    /**
     * Adds an event listener for the specified event.
     * @param event - The event to listen for.
     * @param callback - Function to be called when the event occurs.
     * @returns A listener ID that can be used to remove the listener.
     */
    on(event: string, callback: Function): number;

    /**
     * Removes an event listener.
     * @param listener_id - The ID of the listener to remove.
     * @returns True if the listener was removed, false otherwise.
     */
    off(listener_id: number): boolean;
}

// MQTT API
declare namespace MQTT {
    /**
     * Checks if the device is connected to an MQTT broker.
     * @returns True if connected, false otherwise.
     */
    function isConnected(): boolean;

    /**
     * Subscribes to a topic on the MQTT broker.
     * @param topic - The topic filter to subscribe to.
     * @param callback - Function to be called when a message is published on the topic.
     * @param userdata - Optional user data passed to the callback.
     * @throws Throws an exception if arguments are invalid or MQTT is disabled.
     */
    function subscribe(
        topic: string,
        callback: (topic: string, message: string, userdata?: any) => void,
        userdata?: any
    ): void;

    /**
     * Unsubscribes from a previously subscribed topic.
     * @param topic - The topic to unsubscribe from.
     * @returns True if unsubscribed, false if the subscription does not exist.
     * @throws Throws an exception if the argument is invalid.
     */
    function unsubscribe(topic: string): boolean;

    /**
     * Publishes a message to a topic.
     * @param topic - The topic to publish to.
     * @param message - The message to publish.
     * @param qos - The Quality of Service level (0, 1, or 2). Default is 0.
     * @param retain - If true, the message is retained by the broker. Default is false.
     * @returns True if the message was enqueued for publishing, false if MQTT is disconnected.
     */
    function publish(topic: string, message: string, qos?: 0 | 1 | 2, retain?: boolean): boolean;

    /**
     * Registers a handler for the MQTT connection established event.
     * @param callback - Function to be called when the connection is established.
     * @param userdata - Optional user data passed to the callback.
     */
    function setConnectHandler(callback: (userdata?: any) => void, userdata?: any): void;

    /**
     * Registers a handler for the MQTT connection closed event.
     * @param callback - Function to be called when the connection is closed.
     * @param userdata - Optional user data passed to the callback.
     */
    function setDisconnectHandler(callback: (userdata?: any) => void, userdata?: any): void;
}

// BLE API
declare namespace BLE {
    namespace Scanner {
        const SCAN_START: number;
        const SCAN_STOP: number;
        const SCAN_RESULT: number;
        const INFINITE_SCAN: number;

        interface ScanResult {
            /** Address of the advertising device */
            addr: string;
            /** Type of the device address, can be one of BLE.GAP_ADDRESS_TYPE_* */
            addr_type: number;
            /** Advertisement data */
            advData: string;
            /** Scan response for active scans; a zero-length string for passive scans or when missing */
            scanRsp: string;
            /** Received signal strength indicator */
            rssi: number;
            /** The flags entry of the advertising data, if present */
            flags?: number;
            /** Long or short name of the device, if present in the advertising data */
            local_name?: string;
            /** The manufacturer data entry of the advertising data, if present. Key is the assigned number of the manufacturer */
            manufacturer_data?: { [manufacturerId: number]: string };
            /** List of service UUIDs advertised by the device, if present */
            service_uuids?: string[];
            /** Keys are service UUIDs and values contain the associated service data */
            service_data?: { [serviceUuid: string]: string };
            /** Transmitted power level of the packet, if present */
            tx_power_level?: number;
        }

        interface ScanOptions {
            duration_ms?: number;
            active?: boolean;
            interval_ms?: number;
            window_ms?: number;
        }

        /**
         * Subscribes to scan events.
         * @param callback - Function to be called for scan events.
         * @param userdata - Optional user data passed to the callback.
         * @returns A subscription ID.
         */
        function Subscribe(
            callback: (event: number, result: ScanResult | null, userdata: any) => void,
            userdata?: any
        ): number;

        /**
         * Starts scanning for BLE devices.
         * @param options - Scan options.
         * @returns True if the scan was started successfully, false otherwise.
         */
        function Start(options: ScanOptions): boolean;

        /**
         * Stops the ongoing BLE scan.
         * @returns True if the scan was stopped, false if no scan was running.
         */
        function Stop(): boolean;

        /**
         * Checks if a scan is currently running.
         * @returns True if a scan is running, false otherwise.
         */
        function isRunning(): boolean;

        /**
         * Gets the current scan options.
         * @returns The current scan options or null if no scan is running.
         */
        function GetScanOptions(): ScanOptions | null;
    }

    namespace GAP {
        /**
         * Parses the name from the scan data.
         * @param advData - The advertisement data.
         * @param scanRsp - The scan response data.
         * @returns The device name or null if not found.
         */
        function parseName(advData: string, scanRsp: string): string | null;

        /**
         * Parses the manufacturer data from the scan data.
         * @param advData - The advertisement data.
         * @returns An object with manufacturer IDs as keys and their data as values, or null if not found.
         */
        function parseManufacturerData(advData: string): { [manufacturerId: number]: string } | null;

        /**
         * Parses data from the scan data by EIR type.
         * @param advData - The advertisement data.
         * @param type - The EIR type to look for.
         * @returns The data for the specified type or null if not found.
         */
        function ParseDataByEIRType(advData: string, type: number): string | null;

        /**
         * Checks if a specific service is advertised.
         * @param advData - The advertisement data.
         * @param uuid - The service UUID to look for.
         * @returns True if the service is advertised, false otherwise.
         */
        function HasService(advData: string, uuid: string): boolean;

        /**
         * Parses service data from the scan data.
         * @param advData - The advertisement data.
         * @param uuid - The service UUID to look for.
         * @returns The service data or null if not found.
         */
        function ParseServiceData(advData: string, uuid: string): string | null;
    }
}

// HTTP Server API
declare namespace HTTPServer {
    /**
     * Registers an HTTP endpoint for the script.
     * @param endpoint_name - The name of the endpoint to register.
     * @param callback - Function to be called when a request comes on the registered endpoint.
     * @param userdata - Optional user data passed to the callback.
     * @returns The complete endpoint URL path.
     * @throws Throws an exception if arguments are invalid.
     */
    function registerEndpoint(
        endpoint_name: string,
        callback: (request: {
            method: string;
            query?: string;
            headers: [string, string][];
            body?: string;
        }, response: {
            code?: number;
            body?: string;
            headers?: [string, string][];
            send: () => boolean;
        }, userdata?: any) => void,
        userdata?: any
    ): string;
}

// Timer API
declare namespace Timer {
    /**
     * Creates a new timer.
     * @param timeout_ms - Timeout duration in milliseconds.
     * @param repeat - Whether the timer should repeat.
     * @param callback - Function invoked when the timer expires.
     * @param userdata - Optional user data passed to the callback.
     * @returns A handle to the created timer.
     */
    function set(timeout_ms: number, repeat: boolean, callback: (userdata: any) => void, userdata?: any): number;

    /**
     * Cancels a timer.
     * @param timer_handle - Handle of the timer to cancel.
     * @returns True if the timer was successfully canceled; false otherwise.
     */
    function clear(timer_handle: number): boolean;

    /**
     * Gets information about active timers.
     * @returns Object with information about active timers.
     */
    function getInfo(): object;
}

// Utility Functions
/**
 * Converts a binary string to a hexadecimal string.
 * @param bin - The binary string to convert.
 * @returns The hexadecimal representation of the binary string.
 */
declare function btoh(bin: string): string;

// Other types
/**
 * Prints a message to the console.
 * @param message - The message to print.
 */
declare function print(...args: any[]): void;

interface TemperatureStatus {
    id: number;
    tC: number;
    tF: number;
}
