import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WorkspaceModule from 'resource:///org/gnome/shell/ui/workspace.js';
import {WindowPreview} from 'resource:///org/gnome/shell/ui/windowPreview.js';
import {ApplicationWindowOverview} from './appSpread.js';
import {
    ApplicationGroupedOverviewExtension,
    type GroupedOverviewPreview,
    type GroupedWorkspaceLayoutPrototype,
    type GroupedWorkspaceLayout,
} from './groupedOverview.js';
import {
    setOverviewPreviewStacking,
    type StackableOverviewPreview,
} from './groupedOverviewStacking.js';
import {
    getOverviewWorkspaces,
    invalidateWorkspaceLayout,
} from './overviewInternals.js';

type GnomeWindowPreview = GroupedOverviewPreview<Meta.Window> &
    StackableOverviewPreview;

type GnomeWorkspaceModule = {
    WorkspaceLayout?: {
        prototype: GroupedWorkspaceLayoutPrototype<GnomeWindowPreview>;
    };
};

export function createApplicationGroupedOverviewExtension(
    applicationOverview: ApplicationWindowOverview
): ISubExtension {
    const workspaceModule = WorkspaceModule as unknown as GnomeWorkspaceModule;
    const workspaceLayout = workspaceModule.WorkspaceLayout;
    const workspaceLayoutPrototype =
        Main.overview.isDummy ||
        workspaceLayout === undefined ||
        typeof WindowPreview.prototype.setStackAbove !== 'function' ||
        typeof WindowPreview.prototype._restack !== 'function'
            ? null
            : workspaceLayout.prototype;
    const tracker = Shell.WindowTracker.get_default();

    const restorePreviewStacking = (previews: GnomeWindowPreview[]) => {
        const windows = global.display.sort_windows_by_stacking(
            previews.map(preview => preview.metaWindow)
        );
        const order = new Map(windows.map((window, index) => [window, index]));
        const sorted = [...previews].sort((first, second) => {
            const firstIndex = order.get(first.metaWindow);
            const secondIndex = order.get(second.metaWindow);
            if (firstIndex === undefined || secondIndex === undefined)
                throw new Error('Missing window in desktop stacking order');
            return firstIndex - secondIndex;
        });
        setOverviewPreviewStacking(sorted);
    };

    return new ApplicationGroupedOverviewExtension<
        GnomeWindowPreview,
        Meta.Window
    >({
        workspaceLayoutPrototype,
        isApplicationOverviewActive: () => applicationOverview.active,
        setPreviewStacking: setOverviewPreviewStacking,
        restorePreviewStacking,
        restoreStacking() {
            for (const workspace of getOverviewWorkspaces()) {
                const layout = workspace._container
                    .layout_manager as unknown as GroupedWorkspaceLayout<GnomeWindowPreview>;
                restorePreviewStacking(layout._sortedWindows);
            }
        },
        resolveAppKey(window) {
            const app = tracker.get_window_app(window) as
                | Shell.App
                | null
                | undefined;

            if (app === null || app === undefined) return null;

            const appId = app.get_id() as string | null;
            return appId === null || appId.length === 0 ? null : appId;
        },
        resolveFallbackSource(window) {
            const frame = window.get_frame_rect();

            return {
                x: frame.x,
                y: frame.y,
                width: frame.width,
                height: frame.height,
            };
        },
        invalidateLayouts() {
            for (const workspace of getOverviewWorkspaces())
                invalidateWorkspaceLayout(workspace, {unfreeze: true});
        },
        report(message, error) {
            const prefix = '[touchpad-gesture-customization]';

            if (error === null) console.warn(`${prefix} ${message}`);
            else console.error(`${prefix} ${message}`, error);
        },
    });
}
