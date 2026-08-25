import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WorkspaceModule from 'resource:///org/gnome/shell/ui/workspace.js';
import {
    ApplicationGroupedOverviewExtension,
    type GroupedOverviewPreview,
    type GroupedWorkspaceLayoutPrototype,
} from './groupedOverview.js';
import {
    getOverviewWorkspaces,
    invalidateWorkspaceLayout,
} from './overviewInternals.js';

type GnomeWindowPreview = GroupedOverviewPreview<Meta.Window>;

type GnomeWorkspaceModule = {
    WorkspaceLayout?: {
        prototype: GroupedWorkspaceLayoutPrototype<GnomeWindowPreview>;
    };
};

export function createApplicationGroupedOverviewExtension(): ISubExtension {
    const workspaceModule = WorkspaceModule as unknown as GnomeWorkspaceModule;
    const workspaceLayout = workspaceModule.WorkspaceLayout;
    const workspaceLayoutPrototype =
        Main.overview.isDummy || workspaceLayout === undefined
            ? null
            : workspaceLayout.prototype;
    const tracker = Shell.WindowTracker.get_default();

    return new ApplicationGroupedOverviewExtension<
        GnomeWindowPreview,
        Meta.Window
    >({
        workspaceLayoutPrototype,
        resolveAppKey(window) {
            const app = tracker.get_window_app(window) as
                | Shell.App
                | null
                | undefined;

            if (app === null || app === undefined) return null;

            const appId = app.get_id() as string | null;
            return appId === null || appId.length === 0 ? null : appId;
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
