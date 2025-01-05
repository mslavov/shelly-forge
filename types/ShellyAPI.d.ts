// Shelly API
declare namespace Shelly {
  /**
   * Invokes an RPC method on the local device.
   * @param method - Name of the method to invoke.
   * @param params - Parameters for the method.
   * @param callback - Optional callback invoked upon completion.
   * @param userdata - Optional user data passed to the callback.
   */
  function call(
    method: string,
    params: any | string,
    callback?: (
      result: any | null,
      error_code: number,
      error_message: string,
      userdata: any
    ) => void,
    userdata?: any
  ): void;

  /**
   * Adds an event handler for device events.
   * @param callback - Function invoked when an event occurs.
   * @param userdata - Optional user data passed to the callback.
   * @returns A subscription handle for the event handler.
   */
  function addEventHandler(
    callback: (event_data: object, userdata: any) => void,
    userdata?: any
  ): number;

  /**
   * Removes an event handler.
   * @param subscription_handle - The handle of the event handler to remove.
   * @returns True if the handler was removed; false otherwise.
   */
  function removeEventHandler(subscription_handle: number): boolean;

  /**
   * Adds a status handler for device status changes.
   * @param callback - Function invoked when a status change occurs.
   * @param userdata - Optional user data passed to the callback.
   * @returns A subscription handle for the status handler.
   */
  function addStatusHandler(
    callback: (status_data: object, userdata: any) => void,
    userdata?: any
  ): number;

  /**
   * Removes a status handler.
   * @param subscription_handle - The handle of the status handler to remove.
   * @returns True if the handler was removed; false otherwise.
   */
  function removeStatusHandler(subscription_handle: number): boolean;
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
   * Registers a handler for the MQTT connection established event.
   * @param callback - Function invoked when the connection is established.
   * @param userdata - Optional user data passed to the callback.
   */
  function setConnectHandler(
    callback: (userdata: any) => void,
    userdata?: any
  ): void;

  /**
   * Registers a handler for the MQTT connection closed event.
   * @param callback - Function invoked when the connection is closed.
   * @param userdata - Optional user data passed to the callback.
   */
  function setDisconnectHandler(
    callback: (userdata: any) => void,
    userdata?: any
  ): void;
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
  function set(
    timeout_ms: number,
    repeat: boolean,
    callback: (userdata: any) => void,
    userdata?: any
  ): number;

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
