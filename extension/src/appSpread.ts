import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {SearchController} from 'resource:///org/gnome/shell/ui/searchController.js';
import {Workspace} from 'resource:///org/gnome/shell/ui/workspace.js';
import {WorkspaceThumbnail} from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';

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
        this._resetWorkspaceWindows();

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

    // Force every Workspace/Thumbnail to re-evaluate its window list against the
    // currently-installed `_isOverviewWindow` filter by emitting window-removed
    // followed by window-added for every window. Needed when the filter is
    // installed mid-gesture, after Workspaces have already been populated with
    // an unfiltered window set: re-emitting only `window-added` is a no-op for
    // already-tracked windows, so non-app windows would otherwise stay visible.
    private _resetWorkspaceWindows(): void {
        const {workspaceManager} = global;

        for (let i = 0; i < workspaceManager.nWorkspaces; i++) {
            const metaWorkspace = workspaceManager.get_workspace_by_index(i);

            if (metaWorkspace === null)
                throw new Error(`Missing workspace at index ${i}`);

            const windows = metaWorkspace.list_windows();
            windows.forEach(window =>
                metaWorkspace.emit('window-removed', window)
            );
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
