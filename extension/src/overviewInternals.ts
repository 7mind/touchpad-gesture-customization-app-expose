import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export type OverviewWorkspaceLayout = {
    layout_frozen: boolean;
    _needsLayout?: boolean;
    layout_changed?: () => void;
};

export type OverviewWorkspace = {
    _layoutFrozenId: number;
    _container: {layout_manager: OverviewWorkspaceLayout};
    _skipTaskbarSignals: Map<Meta.Window, number>;
    containsMetaWindow(window: Meta.Window): boolean;
    _isMyWindow(window: Meta.Window): boolean;
    _doAddWindow(window: Meta.Window): void;
    _addWindowClone(window: Meta.Window): void;
    _doRemoveWindow(window: Meta.Window): void;
};

type WorkspaceContainer = {
    _workspaces?: OverviewWorkspace[];
    _workspace?: OverviewWorkspace;
};

type MonitorView = WorkspaceContainer & {
    _workspacesView?: WorkspaceContainer;
};

type OverviewHierarchy = {
    _overview?: {
        _controls?: {
            _workspacesDisplay?: {
                _workspacesViews?: MonitorView[];
            };
        };
    };
};

export type InvalidateWorkspaceLayoutOptions = {
    unfreeze: boolean;
};

export function getOverviewWorkspaces(): OverviewWorkspace[] {
    const overview = Main.overview as unknown as OverviewHierarchy;
    const overviewActor = overview._overview;

    if (overviewActor === undefined) return [];

    const controls = overviewActor._controls;

    if (controls === undefined) return [];

    const display = controls._workspacesDisplay;

    if (display === undefined) return [];

    const result: OverviewWorkspace[] = [];

    for (const view of display._workspacesViews ?? []) {
        const container: WorkspaceContainer = view._workspacesView ?? view;

        if (container._workspaces !== undefined)
            result.push(...container._workspaces);
        else if (container._workspace !== undefined)
            result.push(container._workspace);
    }

    return result;
}

export function unfreezeWorkspaceLayout(workspace: OverviewWorkspace): void {
    if (workspace._layoutFrozenId > 0) {
        GLib.source_remove(workspace._layoutFrozenId);
        workspace._layoutFrozenId = 0;
    }

    workspace._container.layout_manager.layout_frozen = false;
}

export function unfreezeOverviewWorkspaceLayouts(): void {
    for (const workspace of getOverviewWorkspaces())
        unfreezeWorkspaceLayout(workspace);
}

export function invalidateWorkspaceLayout(
    workspace: OverviewWorkspace,
    options: InvalidateWorkspaceLayoutOptions
): void {
    if (options.unfreeze) unfreezeWorkspaceLayout(workspace);

    const layout = workspace._container.layout_manager;

    if ('_needsLayout' in layout) layout._needsLayout = true;
    if (typeof layout.layout_changed === 'function') layout.layout_changed();
}
