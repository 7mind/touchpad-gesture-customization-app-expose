import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {OverviewAdjustment} from 'resource:///org/gnome/shell/ui/overviewControls.js';
import {SwipeTracker} from 'resource:///org/gnome/shell/ui/swipeTracker.js';
import {createSwipeTracker} from './swipeTracker.js';
import {OverviewNavigationState} from '../common/settings.js';
import {ExtSettings, OverviewControlsState} from '../constants.js';
import {ApplicationWindowOverview} from './appSpread.js';

enum ExtensionState {
    // DISABLED = 0,
    DEFAULT = 1,
    CUSTOM = 2,
}

// Threshold (in tracker-progress units, where 1 unit = HIDDEN→WINDOW_PICKER)
// for committing to a direction in APPLICATION_OVERVIEW_ON_DOWN mode. Once
// progress crosses below -hysteresis the app filter installs; the filter is
// only torn down again once progress crosses above +hysteresis. A small
// upward correction within the hysteresis band keeps the current state.
const APP_OVERVIEW_DIRECTION_HYSTERESIS = 0.01;

export class OverviewRoundTripGestureExtension implements ISubExtension {
    private _stateAdjustment: OverviewAdjustment;
    private _oldGetStateTransitionParams: typeof OverviewAdjustment.prototype.getStateTransitionParams;
    private _progress = 0;
    private _extensionState = ExtensionState.DEFAULT;
    private _shownEventId = 0;
    private _hiddenEventId = 0;
    private _navigationStates: OverviewNavigationState;
    private _verticalSwipeTracker?: typeof SwipeTracker.prototype;
    private _horizontalSwipeTracker?: typeof SwipeTracker.prototype;
    private _verticalConnectors?: number[];
    private _horizontalConnectors?: number[];
    private _appOverview: ApplicationWindowOverview;
    private _windowTracker: Shell.WindowTracker;
    private _gestureBeganInAppOverview = false;

    // Whether the gesture started with the app-overview filter already
    // installed (i.e. the user is starting a new swipe from inside the
    // application overview). When true, the gesture is locked to the
    // [HIDDEN, WINDOW_PICKER] range and the hysteresis-based mid-gesture
    // filter toggling is suppressed.
    constructor(navigationStates: OverviewNavigationState) {
        this._navigationStates = navigationStates;
        this._stateAdjustment =
            Main.overview._overview._controls._stateAdjustment;
        this._oldGetStateTransitionParams =
            this._stateAdjustment.getStateTransitionParams;
        this._appOverview = new ApplicationWindowOverview();
        this._windowTracker = Shell.WindowTracker.get_default();
        this._progress = 0;
    }

    private _isAppOverviewOnDown(): boolean {
        return (
            this._navigationStates ===
            OverviewNavigationState.APPLICATION_OVERVIEW_ON_DOWN
        );
    }

    private _tryInstallAppOverviewFilter(): void {
        if (!this._appOverview.supported || this._appOverview.active) return;
        const app = this._windowTracker.focus_app as Shell.App | null;
        if (app === null) return;
        this._appOverview.show(app);
    }

    private _uninstallAppOverviewFilter(): void {
        if (this._appOverview.active)
            this._appOverview.restoreDefaultOverview();
    }

    _getStateTransitionParams(): typeof OverviewAdjustment.prototype.getStateTransitionParams.prototype {
        if (this._extensionState <= ExtensionState.DEFAULT) {
            return this._oldGetStateTransitionParams.call(
                this._stateAdjustment
            );
        } else if (this._extensionState === ExtensionState.CUSTOM) {
            const currentState = this._stateAdjustment.value;
            const initialState = OverviewControlsState.HIDDEN;
            const finalState = OverviewControlsState.APP_GRID;

            const length = Math.abs(finalState - initialState);
            const progress = Math.abs((currentState - initialState) / length);

            return {
                transitioning: true,
                currentState,
                initialState,
                finalState,
                progress,
            };
        }
    }

    setVerticalSwipeTracker(nfingers: number[]) {
        this._verticalConnectors?.forEach(connector =>
            this._verticalSwipeTracker?.disconnect(connector)
        );
        this._verticalSwipeTracker?.destroy();

        this._verticalSwipeTracker = createSwipeTracker(
            global.stage,
            nfingers,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            Clutter.Orientation.VERTICAL,
            ExtSettings.DEFAULT_OVERVIEW_GESTURE_DIRECTION
        );

        this._verticalConnectors = [
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
        this._horizontalConnectors?.forEach(connector =>
            this._horizontalSwipeTracker?.disconnect(connector)
        );
        this._horizontalSwipeTracker?.destroy();

        this._horizontalSwipeTracker = createSwipeTracker(
            global.stage,
            nfingers,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            Clutter.Orientation.HORIZONTAL,
            ExtSettings.DEFAULT_OVERVIEW_GESTURE_DIRECTION
        );

        this._horizontalConnectors = [
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

    apply(): void {
        Main.overview._swipeTracker.enabled = false;

        // override 'getStateTransitionParams' function
        this._stateAdjustment.getStateTransitionParams =
            this._getStateTransitionParams.bind(this);

        this._extensionState = ExtensionState.DEFAULT;
        this._progress = 0;

        // reset extension state to default, when overview is shown and hidden (not showing/hidding event)
        this._shownEventId = Main.overview.connect(
            'shown',
            () => (this._extensionState = ExtensionState.DEFAULT)
        );
        this._hiddenEventId = Main.overview.connect(
            'hidden',
            () => (this._extensionState = ExtensionState.DEFAULT)
        );
    }

    destroy(): void {
        this._verticalConnectors?.forEach(connector =>
            this._verticalSwipeTracker?.disconnect(connector)
        );
        this._verticalSwipeTracker?.destroy();
        this._verticalConnectors = undefined;
        this._verticalSwipeTracker = undefined;

        this._horizontalConnectors?.forEach(connector =>
            this._horizontalSwipeTracker?.disconnect(connector)
        );
        this._horizontalSwipeTracker?.destroy();
        this._horizontalConnectors = undefined;
        this._horizontalSwipeTracker = undefined;

        if (this._appOverview.active) this._appOverview.hide();

        Main.overview._swipeTracker.enabled = true;
        this._stateAdjustment.getStateTransitionParams =
            this._oldGetStateTransitionParams.bind(this._stateAdjustment);
        Main.overview.disconnect(this._shownEventId);
        Main.overview.disconnect(this._hiddenEventId);
    }

    _gestureBegin(tracker: typeof SwipeTracker.prototype): void {
        this._gestureBeganInAppOverview =
            this._isAppOverviewOnDown() && this._appOverview.active;

        const _tracker = {
            confirmSwipe: (
                distance: number,
                _snapPoints: number[],
                currentProgress: number,
                cancelProgress: number
            ) => {
                tracker.confirmSwipe(
                    distance,
                    this._getGestureSnapPoints(),
                    currentProgress,
                    cancelProgress
                );
            },
        };

        Main.overview._gestureBegin(_tracker);
        this._progress = this._stateAdjustment.value;
        this._extensionState = ExtensionState.DEFAULT;
    }

    _gestureUpdate(
        tracker: typeof SwipeTracker.prototype,
        progress: number
    ): void {
        if (this._isAppOverviewOnDown()) {
            if (!this._gestureBeganInAppOverview) {
                const hysteresis = APP_OVERVIEW_DIRECTION_HYSTERESIS;

                if (progress < -hysteresis) this._tryInstallAppOverviewFilter();
                else if (progress > hysteresis)
                    this._uninstallAppOverviewFilter();
            }

            this._extensionState = ExtensionState.DEFAULT;
            this._progress = progress;
            Main.overview._gestureUpdate(
                tracker,
                this._getOverviewProgressValue(progress)
            );
            return;
        }

        if (
            progress < OverviewControlsState.HIDDEN ||
            progress > OverviewControlsState.APP_GRID
        )
            this._extensionState = ExtensionState.CUSTOM;
        else this._extensionState = ExtensionState.DEFAULT;

        this._progress = progress;

        // log(`update: progress=${progress}, overview progress=${this._getOverviewProgressValue(progress)}`);

        Main.overview._gestureUpdate(
            tracker,
            this._getOverviewProgressValue(progress)
        );
    }

    _gestureEnd(
        tracker: typeof SwipeTracker.prototype,
        duration: number,
        endProgress: number
    ): void {
        if (this._isAppOverviewOnDown()) {
            let finalOverviewState: number;

            if (this._appOverview.active) {
                if (this._gestureBeganInAppOverview) {
                    // Already in app overview at gesture start: tracker domain
                    // is shifted to [WINDOW_PICKER, WINDOW_PICKER + 1] so a
                    // finger-up moves progress *up* (toward WINDOW_PICKER + 1
                    // = exit), and finger-down is clamped at WINDOW_PICKER
                    // (stay). Reflect the tracker progress around
                    // WINDOW_PICKER to get the overview state.
                    finalOverviewState = Math.clamp(
                        2 * OverviewControlsState.WINDOW_PICKER - endProgress,
                        OverviewControlsState.HIDDEN,
                        OverviewControlsState.WINDOW_PICKER
                    );
                } else {
                    // Filter installed mid-gesture from a regular state: this
                    // is the swipe-down-to-app-overview commit.
                    finalOverviewState =
                        endProgress >= OverviewControlsState.HIDDEN
                            ? OverviewControlsState.HIDDEN
                            : OverviewControlsState.WINDOW_PICKER;
                }

                if (finalOverviewState === OverviewControlsState.HIDDEN)
                    this._uninstallAppOverviewFilter();
            } else {
                finalOverviewState = Math.clamp(
                    endProgress,
                    OverviewControlsState.HIDDEN,
                    OverviewControlsState.APP_GRID
                );
            }

            this._extensionState = ExtensionState.DEFAULT;
            Main.overview._gestureEnd(tracker, duration, finalOverviewState);
            return;
        }

        if (this._progress < OverviewControlsState.HIDDEN) {
            this._extensionState = ExtensionState.CUSTOM;
            endProgress =
                endProgress >= OverviewControlsState.HIDDEN
                    ? OverviewControlsState.HIDDEN
                    : OverviewControlsState.APP_GRID;
        } else if (this._progress > OverviewControlsState.APP_GRID) {
            this._extensionState = ExtensionState.CUSTOM;
            endProgress =
                endProgress <= OverviewControlsState.APP_GRID
                    ? OverviewControlsState.APP_GRID
                    : OverviewControlsState.HIDDEN;
        } else {
            this._extensionState = ExtensionState.DEFAULT;
            endProgress = Math.clamp(
                endProgress,
                OverviewControlsState.HIDDEN,
                OverviewControlsState.APP_GRID
            );
        }

        // log(`end: progress=${this._progress}, endProgress=${endProgress}, \
        //     overview progress=${this._getOverviewProgressValue(endProgress)}`)
        Main.overview._gestureEnd(tracker, duration, endProgress);
    }

    _getOverviewProgressValue(progress: number): number {
        if (this._isAppOverviewOnDown()) {
            if (this._gestureBeganInAppOverview) {
                // Tracker domain is [WINDOW_PICKER, WINDOW_PICKER + 1]:
                // - progress = WINDOW_PICKER (finger down, clamped): stay
                //   (overview state = WINDOW_PICKER)
                // - progress = WINDOW_PICKER + 1 (finger fully up): close
                //   (overview state = HIDDEN)
                return Math.clamp(
                    2 * OverviewControlsState.WINDOW_PICKER - progress,
                    OverviewControlsState.HIDDEN,
                    OverviewControlsState.WINDOW_PICKER
                );
            }

            const absSidedProgress =
                progress < OverviewControlsState.HIDDEN
                    ? Math.abs(progress)
                    : progress;

            if (this._appOverview.active) {
                // Filter installed mid-gesture: never escape
                // [HIDDEN, WINDOW_PICKER] — the app drawer must not be
                // reachable from the application overview, regardless of
                // swipe direction or distance.
                return Math.clamp(
                    absSidedProgress,
                    OverviewControlsState.HIDDEN,
                    OverviewControlsState.WINDOW_PICKER
                );
            }

            if (progress < OverviewControlsState.HIDDEN) {
                return Math.min(
                    OverviewControlsState.WINDOW_PICKER,
                    absSidedProgress
                );
            }

            return progress;
        }

        if (progress < OverviewControlsState.HIDDEN) {
            return Math.min(
                OverviewControlsState.APP_GRID,
                2 * Math.abs(OverviewControlsState.HIDDEN - progress)
            );
        } else if (progress > OverviewControlsState.APP_GRID) {
            return Math.min(
                OverviewControlsState.APP_GRID,
                2 * Math.abs(OverviewControlsState.HIDDEN_N - progress)
            );
        }

        return progress;
    }

    private _getGestureSnapPoints(): number[] {
        switch (this._navigationStates) {
            case OverviewNavigationState.CYCLIC:
                return [
                    OverviewControlsState.APP_GRID_P,
                    OverviewControlsState.HIDDEN,
                    OverviewControlsState.WINDOW_PICKER,
                    OverviewControlsState.APP_GRID,
                    OverviewControlsState.HIDDEN_N,
                ];
            case OverviewNavigationState.GNOME:
                return [
                    OverviewControlsState.HIDDEN,
                    OverviewControlsState.WINDOW_PICKER,
                    OverviewControlsState.APP_GRID,
                ];
            case OverviewNavigationState.WINDOW_PICKER_ONLY:
                return [
                    OverviewControlsState.HIDDEN,
                    OverviewControlsState.WINDOW_PICKER,
                ];
            case OverviewNavigationState.APPLICATION_OVERVIEW_ON_DOWN:
                if (this._gestureBeganInAppOverview) {
                    // Starting from the application overview: the only
                    // navigations are "stay" and "close" (HIDDEN). Use a
                    // tracker domain *above* WINDOW_PICKER so finger-up has
                    // somewhere to go (toward WINDOW_PICKER + 1 = exit) and
                    // finger-down is naturally clamped at WINDOW_PICKER
                    // (stay). _getOverviewProgressValue / _gestureEnd reflect
                    // the tracker progress around WINDOW_PICKER to derive the
                    // overview state, so finger-up ⇒ close, finger-down ⇒
                    // stay. The app drawer is intentionally unreachable.
                    return [
                        OverviewControlsState.WINDOW_PICKER,
                        OverviewControlsState.WINDOW_PICKER + 1,
                    ];
                }

                return [
                    OverviewControlsState.APP_GRID_P,
                    OverviewControlsState.HIDDEN,
                    OverviewControlsState.WINDOW_PICKER,
                    OverviewControlsState.APP_GRID,
                ];
        }
    }
}
