import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {OverviewAdjustment} from 'resource:///org/gnome/shell/ui/overviewControls.js';
import {
    CustomEventType,
    SwipeTracker,
} from 'resource:///org/gnome/shell/ui/swipeTracker.js';
import {SearchController} from 'resource:///org/gnome/shell/ui/searchController.js';
import {Workspace} from 'resource:///org/gnome/shell/ui/workspace.js';
import {WorkspaceThumbnail} from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';
import {OverviewControlsState} from '../constants.js';
import {createSwipeTracker} from './swipeTracker.js';

class ApplicationWindowOverview {
    private _app: Shell.App | null = null;
    private _windows: Meta.Window[] = [];
    private _hiddenSignalId = 0;
    private _showAppsButtonSignalId = 0;
    private _windowsChangedSignalId = 0;
    private _workspaceIsOverviewWindow?: typeof Workspace.prototype._isOverviewWindow;
    private _thumbnailIsOverviewWindow?: typeof WorkspaceThumbnail.prototype._isOverviewWindow;
    private _shouldTriggerSearch?: typeof SearchController.prototype._shouldTriggerSearch;
    private _searchEntryOpacity = 255;
    private _searchEntryReactive = true;
    readonly supported: boolean;

    constructor() {
        this.supported =
            !Main.overview.isDummy &&
            typeof Workspace.prototype._isOverviewWindow === 'function' &&
            typeof WorkspaceThumbnail.prototype._isOverviewWindow ===
                'function';
    }

    get active(): boolean {
        return this._app !== null;
    }

    show(app: Shell.App): boolean {
        if (!this.supported || this.active) return false;

        this._app = app;
        this._updateWindows();

        if (this._windows.length === 0) {
            this._app = null;
            return false;
        }

        this._patchWindowFiltering();
        this._disableSearch();

        this._hiddenSignalId = Main.overview.connect('hidden', () =>
            this.hide()
        );
        this._showAppsButtonSignalId =
            Main.overview.dash.showAppsButton.connect('notify::checked', () => {
                if (Main.overview.dash.showAppsButton.checked)
                    this.restoreDefaultOverview();
            });
        this._windowsChangedSignalId = app.connect('windows-changed', () => {
            this._updateWindows();

            if (this._windows.length <= 1) Main.overview.hide();
        });

        return true;
    }

    hide(): void {
        if (!this.active) return;

        if (this._hiddenSignalId !== 0) {
            Main.overview.disconnect(this._hiddenSignalId);
            this._hiddenSignalId = 0;
        }

        if (this._showAppsButtonSignalId !== 0) {
            Main.overview.dash.showAppsButton.disconnect(
                this._showAppsButtonSignalId
            );
            this._showAppsButtonSignalId = 0;
        }

        if (this._app && this._windowsChangedSignalId !== 0) {
            this._app.disconnect(this._windowsChangedSignalId);
            this._windowsChangedSignalId = 0;
        }

        this._restoreSearch();
        this._restoreWindowFiltering();

        if (this._windows.length === 1 && !Main.overview.visible)
            Main.activateWindow(this._windows[0]);

        this._app = null;
        this._windows = [];
    }

    restoreDefaultOverview(): void {
        if (!this.active) return;

        this.hide();
        this._restoreDefaultWindows();
    }

    private _hasWindow(window: Meta.Window): boolean {
        return this._windows.includes(window);
    }

    private _updateWindows(): void {
        if (this._app === null) {
            this._windows = [];
            return;
        }

        this._windows = this._app.get_windows();
    }

    private _patchWindowFiltering(): void {
        const hasWindow = (window: Meta.Window) => this._hasWindow(window);
        const getWorkspaceIsOverviewWindow = () =>
            this._workspaceIsOverviewWindow;
        const getThumbnailIsOverviewWindow = () =>
            this._thumbnailIsOverviewWindow;
        const workspacePrototype = Workspace.prototype;
        const thumbnailPrototype = WorkspaceThumbnail.prototype;

        this._workspaceIsOverviewWindow = workspacePrototype._isOverviewWindow;
        this._thumbnailIsOverviewWindow = thumbnailPrototype._isOverviewWindow;

        workspacePrototype._isOverviewWindow = function (
            this: Workspace,
            window: Meta.Window
        ) {
            const workspaceIsOverviewWindow = getWorkspaceIsOverviewWindow();

            if (workspaceIsOverviewWindow === undefined)
                throw new Error('Missing workspace overview window filter');

            return (
                workspaceIsOverviewWindow.call(this, window) &&
                hasWindow(window)
            );
        };

        thumbnailPrototype._isOverviewWindow = function (
            this: WorkspaceThumbnail,
            windowActor: Meta.WindowActor
        ) {
            const thumbnailIsOverviewWindow = getThumbnailIsOverviewWindow();

            if (thumbnailIsOverviewWindow === undefined)
                throw new Error('Missing thumbnail overview window filter');

            return (
                thumbnailIsOverviewWindow.call(this, windowActor) &&
                hasWindow(windowActor.metaWindow)
            );
        };
    }

    private _restoreWindowFiltering(): void {
        if (this._workspaceIsOverviewWindow !== undefined) {
            Workspace.prototype._isOverviewWindow =
                this._workspaceIsOverviewWindow;
            this._workspaceIsOverviewWindow = undefined;
        }

        if (this._thumbnailIsOverviewWindow !== undefined) {
            WorkspaceThumbnail.prototype._isOverviewWindow =
                this._thumbnailIsOverviewWindow;
            this._thumbnailIsOverviewWindow = undefined;
        }
    }

    private _restoreDefaultWindows(): void {
        const {workspaceManager} = global;

        for (let i = 0; i < workspaceManager.nWorkspaces; i++) {
            const metaWorkspace = workspaceManager.get_workspace_by_index(i);

            if (metaWorkspace === null)
                throw new Error(`Missing workspace at index ${i}`);

            const windows = metaWorkspace.list_windows();
            windows.forEach(window =>
                metaWorkspace.emit('window-added', window)
            );
        }
    }

    private _disableSearch(): void {
        const searchEntry = Main.overview.searchEntry;

        if (searchEntry) {
            this._searchEntryOpacity = searchEntry.opacity;
            this._searchEntryReactive = searchEntry.reactive;
            searchEntry.opacity = 0;
            searchEntry.reactive = false;
        }

        if (!SearchController.prototype._shouldTriggerSearch) return;

        this._shouldTriggerSearch =
            SearchController.prototype._shouldTriggerSearch;
        SearchController.prototype._shouldTriggerSearch = () => false;
    }

    private _restoreSearch(): void {
        const searchEntry = Main.overview.searchEntry;

        if (searchEntry) {
            searchEntry.opacity = this._searchEntryOpacity;
            searchEntry.reactive = this._searchEntryReactive;
        }

        if (this._shouldTriggerSearch !== undefined) {
            SearchController.prototype._shouldTriggerSearch =
                this._shouldTriggerSearch;
            this._shouldTriggerSearch = undefined;
        }
    }
}

export class ApplicationOverviewGestureExtension implements ISubExtension {
    private _stateAdjustment: OverviewAdjustment;
    private _swipeTracker: SwipeTracker;
    private _connectors: number[];
    private _appOverview: ApplicationWindowOverview;
    private _windowTracker: Shell.WindowTracker;
    private _gestureActive = false;

    constructor(nfingers: number[]) {
        this._stateAdjustment =
            Main.overview._overview._controls._stateAdjustment;
        this._appOverview = new ApplicationWindowOverview();
        this._windowTracker = Shell.WindowTracker.get_default();
        this._swipeTracker = createSwipeTracker(
            global.stage,
            nfingers,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            Clutter.Orientation.VERTICAL,
            false,
            1,
            {
                allowTouch: false,
                checkAllowedGesture: this._canHandleGesture.bind(this),
            }
        );

        this._connectors = [
            this._swipeTracker.connect('begin', this._gestureBegin.bind(this)),
            this._swipeTracker.connect(
                'update',
                this._gestureUpdate.bind(this)
            ),
            this._swipeTracker.connect('end', this._gestureEnd.bind(this)),
        ];
    }

    destroy(): void {
        this._connectors.forEach(connector =>
            this._swipeTracker.disconnect(connector)
        );
        this._connectors = [];
        this._swipeTracker.destroy();

        if (this._appOverview.active && Main.overview.visible)
            this._appOverview.restoreDefaultOverview();
        else this._appOverview.hide();
    }

    private _canHandleGesture(_event: CustomEventType): boolean {
        if (!this._appOverview.supported) return false;

        if (Main.overview.visible) return this._appOverview.active;

        return this._getFocusedApp() !== null;
    }

    private _gestureBegin(tracker: SwipeTracker): void {
        if (!this._appOverview.active) {
            const app = this._getFocusedApp();

            if (app === null || !this._appOverview.show(app)) {
                this._confirmNoopSwipe(tracker);
                return;
            }
        }

        const startProgress = Math.clamp(
            this._stateAdjustment.value,
            OverviewControlsState.HIDDEN,
            OverviewControlsState.WINDOW_PICKER
        );
        const overviewTracker = {
            confirmSwipe: (
                distance: number,
                _snapPoints: number[],
                _currentProgress: number,
                _cancelProgress: number
            ) => {
                tracker.confirmSwipe(
                    distance,
                    [
                        OverviewControlsState.HIDDEN,
                        OverviewControlsState.WINDOW_PICKER,
                    ],
                    startProgress,
                    startProgress
                );
            },
        };

        this._gestureActive = true;
        Main.overview._gestureBegin(overviewTracker);
    }

    private _gestureUpdate(tracker: SwipeTracker, progress: number): void {
        if (!this._gestureActive) return;

        Main.overview._gestureUpdate(
            tracker,
            this._clampOverviewProgress(progress)
        );
    }

    private _gestureEnd(
        tracker: SwipeTracker,
        duration: number,
        endProgress: number
    ): void {
        if (!this._gestureActive) return;

        const finalProgress = this._clampOverviewProgress(endProgress);

        this._gestureActive = false;
        Main.overview._gestureEnd(tracker, duration, finalProgress);

        if (
            finalProgress === OverviewControlsState.HIDDEN &&
            !Main.overview.visible
        )
            this._appOverview.hide();
    }

    private _confirmNoopSwipe(tracker: SwipeTracker): void {
        this._gestureActive = false;
        tracker.confirmSwipe(
            1,
            [OverviewControlsState.HIDDEN],
            OverviewControlsState.HIDDEN,
            OverviewControlsState.HIDDEN
        );
    }

    private _getFocusedApp(): Shell.App | null {
        return this._windowTracker.focus_app as Shell.App | null;
    }

    private _clampOverviewProgress(progress: number): number {
        return Math.clamp(
            progress,
            OverviewControlsState.HIDDEN,
            OverviewControlsState.WINDOW_PICKER
        );
    }
}
