import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {loadInterfaceXML} from 'resource:///org/gnome/shell/misc/fileUtils.js';
import {SwipeTracker} from 'resource:///org/gnome/shell/ui/swipeTracker.js';
import {createSwipeTracker} from './swipeTracker.js';
import {ExtSettings, TouchpadConstants} from '../constants.js';
import {showOsd} from './utils/compat.js';

const BRIGHTNESS_OSD_FPS_CAP_MS = 1000 / 30;

// Brightness is exposed as 0..100 to the rest of the extension.
interface IBrightnessBackend {
    // Current global brightness, 0..100.
    get(): number;

    // Set global brightness, 0..100.
    set(value: number): void;
    destroy(): void;
}

// GNOME 49+ backend: read/write brightness through Main.brightnessManager.
class ManagerBrightnessBackend implements IBrightnessBackend {
    private _manager: NonNullable<typeof Main.brightnessManager>;
    private _changedId: number | null = null;

    constructor(manager: NonNullable<typeof Main.brightnessManager>) {
        this._manager = manager;

        // Keep in sync if manager changes (defensive).
        this._changedId = this._manager.connect('changed', () => {
            // no-op: manager state is read when gestures start/update
        });
    }

    get(): number {
        // _globalScale is a scale object; its value is 0..1.
        const gs = this._manager._globalScale;
        return gs ? Math.round(gs._value * 100) : 0;
    }

    set(value: number): void {
        const clamped = Math.max(0, Math.min(100, Math.round(value)));
        this._manager._globalScale._setValue(clamped / 100);
    }

    destroy(): void {
        if (this._changedId !== null) {
            this._manager.disconnect(this._changedId);
            this._changedId = null;
        }
    }
}

const BrightnessProxy = Gio.DBusProxy.makeProxyWrapper(
    loadInterfaceXML('org.gnome.SettingsDaemon.Power.Screen')
) as unknown as new (
    connection: Gio.DBusConnection,
    name: string | null,
    objectPath: string,
    callback?: (proxy: Gio.DBusProxy, error: Error | null) => void
) => Gio.DBusProxy;

// GNOME 48 backend: read/write brightness through the power D-Bus proxy
// (Main.brightnessManager does not exist on GNOME 48).
class DBusBrightnessBackend implements IBrightnessBackend {
    private _proxy: Gio.DBusProxy;

    constructor() {
        this._proxy = new BrightnessProxy(
            Gio.DBus.session,
            'org.gnome.SettingsDaemon.Power',
            '/org/gnome/SettingsDaemon/Power',
            (proxy, error) => {
                if (error)
                    console.error(
                        `Failed to connect to the ${proxy.g_interface_name} D-Bus interface`,
                        error
                    );
            }
        );
    }

    get(): number {
        return this._proxy.Brightness ?? 0;
    }

    set(value: number): void {
        if (this._proxy.Brightness === null) return;
        this._proxy.Brightness = value;
    }

    destroy(): void {}
}

export class BrightnessControlGestureExtension implements ISubExtension {
    private _verticalSwipeTracker?: SwipeTracker;
    private _horizontalSwipeTracker?: SwipeTracker;
    private _verticalConnectHandlers?: number[];
    private _horizontalConnectHandlers?: number[];
    private _backend?: IBrightnessBackend;
    private _lastOsdShowTimestamp: number = 0;

    apply() {
        this._backend = Main.brightnessManager
            ? new ManagerBrightnessBackend(Main.brightnessManager)
            : new DBusBrightnessBackend();
    }

    destroy(): void {
        this._backend?.destroy();
        this._backend = undefined;

        this._verticalConnectHandlers?.forEach(handle =>
            this._verticalSwipeTracker?.disconnect(handle)
        );
        this._verticalConnectHandlers = undefined;
        this._verticalSwipeTracker?.destroy();

        this._horizontalConnectHandlers?.forEach(handle =>
            this._horizontalSwipeTracker?.disconnect(handle)
        );
        this._horizontalConnectHandlers = undefined;
        this._horizontalSwipeTracker?.destroy();
    }

    setVerticalSwipeTracker(nfingers: number[]) {
        this._verticalSwipeTracker = createSwipeTracker(
            global.stage,
            nfingers,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            Clutter.Orientation.VERTICAL,
            !ExtSettings.INVERT_BRIGHTNESS_DIRECTION,
            TouchpadConstants.BRIGHTNESS_CONTROL_MULTIPLIER * 100,
            {allowTouch: false}
        );

        this._verticalConnectHandlers = [
            this._verticalSwipeTracker.connect(
                'begin',
                this._gestureBegin.bind(this)
            ),
            this._verticalSwipeTracker.connect(
                'update',
                this._gestureUpdate.bind(this)
            ),
            this._verticalSwipeTracker.connect(
                'end',
                this._gestureEnd.bind(this)
            ),
        ];
    }

    setHorizontalSwipeTracker(nfingers: number[]) {
        this._horizontalSwipeTracker = createSwipeTracker(
            global.stage,
            nfingers,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            Clutter.Orientation.HORIZONTAL,
            !ExtSettings.INVERT_BRIGHTNESS_DIRECTION,
            TouchpadConstants.BRIGHTNESS_CONTROL_MULTIPLIER * 100,
            {allowTouch: false}
        );

        this._horizontalConnectHandlers = [
            this._horizontalSwipeTracker.connect(
                'begin',
                this._gestureBegin.bind(this)
            ),
            this._horizontalSwipeTracker.connect(
                'update',
                this._gestureUpdate.bind(this)
            ),
            this._horizontalSwipeTracker.connect(
                'end',
                this._gestureEnd.bind(this)
            ),
        ];
    }

    _showOsd(brightness: number) {
        // If osd is updated too frequently, it may lag or freeze, so cap it to 30 fps
        const nowTimestamp = Date.now();

        if (
            nowTimestamp - this._lastOsdShowTimestamp <
            BRIGHTNESS_OSD_FPS_CAP_MS
        ) {
            return;
        }

        this._lastOsdShowTimestamp = nowTimestamp;

        const level = brightness / 100;

        const icon = Gio.Icon.new_for_string('display-brightness-symbolic');

        showOsd(icon, null, level, 1);
    }

    // Current global brightness as 0..100.
    get _brightness() {
        return this._backend?.get() ?? 0;
    }

    // Set global brightness; accepts 0..100.
    set _brightness(value) {
        this._backend?.set(value);
    }

    _gestureBegin(_tracker: SwipeTracker): void {
        _tracker.confirmSwipe(
            global.screen_height,
            [0, 100], // no snapping is needed as brightness change is continuous, but this will automatically clamp progress to [0, 100]
            this._brightness, // current brightness
            0 // can be whatever
        );
    }

    _gestureUpdate(_tracker: SwipeTracker, progress: number): void {
        // Round instead of truncating so that brightness changes sync exactly with extensions like "OSD Volume Number"
        const brightness = Math.round(progress);
        this._brightness = brightness;
        this._showOsd(brightness);
    }

    _gestureEnd(
        _tracker: SwipeTracker,
        duration: number,
        progress: number
    ): void {}
}
