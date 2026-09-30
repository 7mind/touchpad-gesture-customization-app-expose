import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

function createHarness(useManager) {
    const displays = [];
    const trackers = [];
    const proxy = {Brightness: 42};
    let timestamp = 1000;
    let connected = false;
    const osd = {
        show(monitor, icon, label, level) {
            displays.push({monitor, icon, label, level});
        },
    };
    const originalShow = osd.show;
    const manager = {
        _globalScale: {
            _value: 0.423,
            _setValue(value) {
                this._value = value;
                osd.show(0, 'stock', null, value);
            },
        },
        connect() {
            connected = true;
            return 1;
        },
        disconnect() {
            connected = false;
        },
    };
    if (useManager)
        osd.showAll = (icon, label, level) => osd.show(-1, icon, label, level);

    const createTracker = () => {
        const callbacks = new Map();
        const tracker = {
            destroyed: false,
            confirmation: null,
            connect(signal, callback) {
                callbacks.set(signal, callback);
                return signal;
            },
            disconnect(signal) {
                callbacks.delete(signal);
            },
            destroy() {
                this.destroyed = true;
            },
            confirmSwipe(distance, points, current) {
                this.confirmation = {
                    distance,
                    points: Array.from(points),
                    current,
                };
            },
            emit(signal, value) {
                timestamp += 100;
                callbacks.get(signal)(this, value);
            },
        };
        trackers.push(tracker);
        return tracker;
    };

    const modules = new Map([
        [
            'gi://Clutter',
            {default: {Orientation: {VERTICAL: 0, HORIZONTAL: 1}}},
        ],
        ['gi://Shell', {default: {ActionMode: {NORMAL: 1, OVERVIEW: 2}}}],
        ['gi://Meta', {default: {}}],
        [
            'gi://Gio',
            {
                default: {
                    Icon: {new_for_string: name => name},
                    DBus: {session: {}},
                    DBusProxy: {
                        makeProxyWrapper: () =>
                            class {
                                constructor() {
                                    return proxy;
                                }
                            },
                    },
                },
            },
        ],
        [
            'resource:///org/gnome/shell/ui/main.js',
            {
                brightnessManager: useManager ? manager : undefined,
                osdWindowManager: osd,
            },
        ],
        [
            'resource:///org/gnome/shell/ui/swipeTracker.js',
            {SwipeTracker: class {}},
        ],
        [
            'resource:///org/gnome/shell/misc/fileUtils.js',
            {
                loadInterfaceXML() {
                    assert.equal(
                        useManager,
                        false,
                        'GNOME 49+ must not load the removed Screen interface'
                    );
                    return '<node/>';
                },
            },
        ],
        [
            new URL('../build/src/swipeTracker.js', import.meta.url).href,
            {createSwipeTracker: createTracker},
        ],
    ]);

    const load = url => {
        if (modules.has(url)) return modules.get(url);
        const exports = {};
        const source = ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2021,
            },
        }).outputText;
        runInNewContext(source, {
            exports,
            require: name =>
                load(name.startsWith('.') ? new URL(name, url).href : name),
            global: {stage: {}, screen_height: 1080},
            Date: {now: () => timestamp},
            console,
        });
        modules.set(url, exports);
        return exports;
    };

    const {BrightnessControlGestureExtension} = load(
        new URL('../build/src/brightnessControl.js', import.meta.url).href
    );
    return {
        extension: new BrightnessControlGestureExtension(),
        trackers,
        displays,
        read: () =>
            useManager ? manager._globalScale._value : proxy.Brightness,
        restored: () =>
            osd.show === originalShow &&
            !connected &&
            !('_touchpadGestureCustomizationMuteShow' in osd),
        showStock: () => osd.show(0, 'stock', null, 0.5),
    };
}

for (const useManager of [false, true]) {
    const harness = createHarness(useManager);
    harness.extension.setVerticalSwipeTracker([3]);
    harness.extension.setHorizontalSwipeTracker([4]);
    harness.extension.apply();

    for (const tracker of harness.trackers) {
        tracker.emit('begin');
        assert.deepEqual(tracker.confirmation.points, [0, 1]);
        assert.equal(tracker.confirmation.current, useManager ? 0.423 : 0.42);
    }

    for (const tracker of harness.trackers)
        for (const progress of [0.427, 0, 1]) {
            const count = harness.displays.length;
            tracker.emit('update', progress);
            assert.equal(
                harness.read(),
                useManager ? progress : Math.round(progress * 100)
            );
            assert.equal(
                harness.displays.length,
                count + 1,
                'one OSD per gesture update'
            );
            assert.equal(harness.displays.at(-1).level, progress);
        }

    harness.showStock();
    assert.equal(harness.displays.at(-1).icon, 'stock');
    harness.extension.destroy();
    assert.equal(harness.restored(), true);
    assert.ok(harness.trackers.every(tracker => tracker.destroyed));
}

console.log(
    'brightness gesture tests passed with GNOME 48 and 49+ API dummies'
);
