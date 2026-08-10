import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {SearchController} from 'resource:///org/gnome/shell/ui/searchController.js';
import {Workspace} from 'resource:///org/gnome/shell/ui/workspace.js';
import {WorkspaceThumbnail} from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';
import {shouldShowInApplicationOverview} from './appOverviewWindowFilter.js';

// A live Workspace actor as shown in the overview, one per (workspace ×
// monitor). On secondary monitors with workspaces-only-on-primary its
// metaWorkspace is null.
type OverviewWorkspace = {
    _layoutFrozenId: number;
    _container: {layout_manager: {layout_frozen: boolean}};
    _skipTaskbarSignals: Map<Meta.Window, number>;
    containsMetaWindow(window: Meta.Window): boolean;
    _isMyWindow(window: Meta.Window): boolean;
    _doAddWindow(window: Meta.Window): void;
    _addWindowClone(window: Meta.Window): void;
    _doRemoveWindow(window: Meta.Window): void;
};

// Holds Workspace actors: WorkspacesView (primary, _workspaces array) or
// ExtraWorkspaceView (secondary, single _workspace).
type WorkspaceContainer = {
    _workspaces?: OverviewWorkspace[];
    _workspace?: OverviewWorkspace;
};

// An entry of WorkspacesDisplay._workspacesViews: either a WorkspacesView
// (primary, a WorkspaceContainer itself) or a SecondaryMonitorDisplay, which
// wraps its container one level deeper in _workspacesView.
type MonitorView = WorkspaceContainer & {
    _workspacesView?: WorkspaceContainer;
};

export class ApplicationWindowOverview {
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
        this._addApplicationWorkspaceWindows();
        this._removeFilteredWorkspaceWindows();
        this._unfreezeWorkspaceLayouts();

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
        this._removeWindowsRejectedByRestoredFilter();
        this._restoreWindowFiltering();

        if (this._windows.length === 1 && !Main.overview.visible)
            Main.activateWindow(this._windows[0]);

        this._app = null;
        this._windows = [];
    }

    restoreDefaultOverview(): void {
        if (!this.active) return;

        this.hide();
        this._refreshWorkspaceWindows();
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
            return shouldShowInApplicationOverview(window, hasWindow);
        };

        thumbnailPrototype._isOverviewWindow = function (
            this: WorkspaceThumbnail,
            windowActor: Meta.WindowActor
        ) {
            const thumbnailIsOverviewWindow = getThumbnailIsOverviewWindow();

            if (thumbnailIsOverviewWindow === undefined)
                throw new Error('Missing thumbnail overview window filter');

            const metaWindow = windowActor.metaWindow;

            return (
                metaWindow !== null &&
                thumbnailIsOverviewWindow.call(this, windowActor) &&
                hasWindow(metaWindow)
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

    private _refreshWorkspaceWindows(): void {
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

    private _addApplicationWorkspaceWindows(): void {
        for (const workspace of this._getOverviewWorkspaces()) {
            for (const window of this._windows) {
                const shouldAdd =
                    !workspace.containsMetaWindow(window) &&
                    workspace._isMyWindow(window) &&
                    shouldShowInApplicationOverview(window, candidate =>
                        this._hasWindow(candidate)
                    );

                if (!shouldAdd) continue;

                if (workspace._skipTaskbarSignals.has(window)) {
                    if (window.get_compositor_private() !== null)
                        workspace._addWindowClone(window);
                } else {
                    workspace._doAddWindow(window);
                }
            }
        }
    }

    private _removeWindowsRejectedByRestoredFilter(): void {
        const workspaceIsOverviewWindow = this._workspaceIsOverviewWindow;

        if (workspaceIsOverviewWindow === undefined)
            throw new Error('Missing workspace overview window filter');

        for (const workspace of this._getOverviewWorkspaces()) {
            for (const window of this._windows) {
                if (
                    workspace.containsMetaWindow(window) &&
                    !workspaceIsOverviewWindow.call(
                        workspace as unknown as Workspace,
                        window
                    )
                )
                    workspace._doRemoveWindow(window);
            }
        }
    }

    // Every live Workspace actor currently shown in the overview, across all
    // monitors. A primary monitor's view is a WorkspacesView (with a
    // _workspaces array); a secondary monitor's view is a
    // SecondaryMonitorDisplay that nests its WorkspaceContainer one level
    // deeper in _workspacesView (an ExtraWorkspaceView with a single
    // _workspace, or a WorkspacesView). Descending into both is required to
    // reach secondary-monitor Workspaces.
    private _getOverviewWorkspaces(): OverviewWorkspace[] {
        const display = Main.overview._overview._controls
            ._workspacesDisplay as unknown as {
            _workspacesViews?: MonitorView[];
        };

        const result: OverviewWorkspace[] = [];

        for (const view of display._workspacesViews ?? []) {
            const container: WorkspaceContainer = view._workspacesView ?? view;

            if (container._workspaces) result.push(...container._workspaces);
            else if (container._workspace) result.push(container._workspace);
        }

        return result;
    }

    // When the filter is installed mid-gesture, Workspaces have already been
    // populated unfiltered. We need to evict the windows that no longer pass
    // the filter — but NOT touch windows that should remain visible: GNOME's
    // _doAddWindow re-animates new clones from scale 0 → 1, so emitting
    // window-removed+window-added for an already-visible window makes it
    // collapse to a dot and pop back out. Emit window-removed only for the
    // windows being filtered out; app windows keep their existing clones and
    // animate smoothly into their new layout positions.
    private _removeFilteredWorkspaceWindows(): void {
        const {workspaceManager} = global;

        for (let i = 0; i < workspaceManager.nWorkspaces; i++) {
            const metaWorkspace = workspaceManager.get_workspace_by_index(i);

            if (metaWorkspace === null)
                throw new Error(`Missing workspace at index ${i}`);

            metaWorkspace.list_windows().forEach(window => {
                if (!this._hasWindow(window))
                    metaWorkspace.emit('window-removed', window);
            });
        }

        // The window-removed emit above only reaches Workspaces bound to a
        // metaWorkspace (the primary-monitor Workspaces and the workspace
        // thumbnails). With workspaces-only-on-primary (the default) the
        // Workspace shown on each secondary monitor is constructed with
        // metaWorkspace === null and is driven by monitor signals instead, so
        // the emit never evicts its non-app clones. Remove them directly from
        // every live overview Workspace; containsMetaWindow keeps this
        // idempotent, so clones already removed via the emit are skipped.
        const windows = global
            .get_window_actors()
            .map(actor => actor.metaWindow)
            .filter((window): window is Meta.Window => window !== null);

        for (const workspace of this._getOverviewWorkspaces()) {
            for (const window of windows) {
                if (
                    !this._hasWindow(window) &&
                    workspace.containsMetaWindow(window)
                )
                    workspace._doRemoveWindow(window);
            }
        }
    }

    // _doRemoveWindow freezes the WorkspaceLayout for 750ms (or until pointer
    // moves outside the workspace), so the remaining clones don't reflow
    // mid-gesture. Under a touchpad swipe the pointer doesn't move, so the
    // layout stays frozen and windows snap to their final positions only when
    // the timer fires — typically after the gesture has ended. Force the
    // unfreeze immediately so the app windows tween to their new positions
    // alongside the overview transition.
    private _unfreezeWorkspaceLayouts(): void {
        for (const ws of this._getOverviewWorkspaces()) {
            if (ws._layoutFrozenId > 0) {
                GLib.source_remove(ws._layoutFrozenId);
                ws._layoutFrozenId = 0;
            }

            ws._container.layout_manager.layout_frozen = false;
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
