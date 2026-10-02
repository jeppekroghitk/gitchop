/**
 * The slice of the WebExtension API gitchop calls, as both browsers offer it with promises:
 * Firefox on `browser`, Chrome MV3 on `chrome`. Only what src/ uses is declared, so a call to
 * anything else is a type error until it is added here. A member the code reaches with `?.` is
 * optional here too, because some browser or version gitchop supports goes without it.
 */
declare namespace WebExt {
  interface Event<Listener extends (...args: any[]) => unknown> {
    addListener(listener: Listener): void;
    removeListener(listener: Listener): void;
  }

  /** Storage holds whatever was written, by this version or an older one; every reader sanitizes. */
  type StoredItems = { [key: string]: any };

  interface StorageArea {
    get(keys?: string | string[] | null): Promise<StoredItems>;
    set(items: { [key: string]: unknown }): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
  }

  interface StorageChange {
    oldValue?: any;
    newValue?: any;
  }

  type AreaName = 'local' | 'sync' | 'managed' | 'session';

  interface Storage {
    local: StorageArea;
    sync: StorageArea;
    session?: StorageArea;
    onChanged: Event<(changes: { [key: string]: StorageChange }, area: AreaName) => void>;
  }

  interface MessageSender {
    id?: string;
    url?: string;
    tab?: { id?: number; url?: string };
  }

  interface Manifest {
    name: string;
    version: string;
    [key: string]: unknown;
  }

  interface Runtime {
    /** The background answers whatever it answers; src/background/messages.js types the protocol. */
    sendMessage(message: unknown): Promise<any>;
    onMessage: Event<(message: any, sender: MessageSender, respond: (response?: unknown) => void) => boolean | void>;
    onInstalled: Event<(details: { reason: 'install' | 'update' | 'browser_update' | 'chrome_update' | 'shared_module_update'; previousVersion?: string }) => void>;
    onStartup?: Event<() => void>;
    openOptionsPage(): Promise<void>;
    getManifest(): Manifest;
    /** Firefox only, which is what makes it the way to tell the two apart. */
    getBrowserInfo?(): Promise<{ name: string; version: string }>;
  }

  interface Alarm {
    name: string;
    scheduledTime: number;
    periodInMinutes?: number;
  }

  interface Alarms {
    create(name: string, info: { when?: number; delayInMinutes?: number; periodInMinutes?: number }): Promise<void> | void;
    get(name: string): Promise<Alarm | undefined>;
    clear(name: string): Promise<boolean>;
    onAlarm: Event<(alarm: Alarm) => void>;
  }

  interface Action {
    setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    setBadgeBackgroundColor?(details: { color: string; tabId?: number }): Promise<void>;
    setBadgeTextColor?(details: { color: string; tabId?: number }): Promise<void>;
    setTitle(details: { title: string; tabId?: number }): Promise<void>;
    onClicked: Event<() => void>;
  }

  interface PermissionSet {
    origins?: string[];
    permissions?: string[];
    /** Firefox only: the data collection the manifest declares as optional. */
    data_collection?: string[];
  }

  interface Permissions {
    contains(permissions: PermissionSet): Promise<boolean>;
    request(permissions: PermissionSet): Promise<boolean>;
    onAdded?: Event<(permissions: PermissionSet) => void>;
    onRemoved?: Event<(permissions: PermissionSet) => void>;
  }

  interface Api {
    storage: Storage;
    runtime: Runtime;
    alarms?: Alarms;
    action: Action;
    permissions: Permissions;
  }
}

declare var browser: WebExt.Api | undefined;
declare var chrome: WebExt.Api;
