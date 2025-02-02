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

// BLE Scanner API
declare namespace BLE {
    namespace Scanner {
        const SCAN_START: number;
        const SCAN_STOP: number;
        const SCAN_RESULT: number;
        const INFINITE_SCAN: number;

        /**
         * Starts scanning for BLE devices.
         * @param duration_ms - Duration of the scan in milliseconds.
         * @param callback - Function invoked on scan events.
         * @param userdata - Optional user data passed to the callback.
         */
        function start(
            duration_ms: number,
            callback: (event: number, result: object | null, userdata: any) => void,
            userdata?: any
        ): void;

        /**
         * Stops the ongoing BLE scan.
         */
        function stop(): void;
    }
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
     * Checks whether a timer is active.
     * @param timer_handle - Handle of the timer to check.
     * @returns True if the timer is active; false otherwise.
     */
    function isActive(timer_handle: number): boolean;
}

// Types
interface TemperatureStatus {
    id: number;
    tC: number;
    tF: number;
}

// Other types
declare function print(message: string): void;
