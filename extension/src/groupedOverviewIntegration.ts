import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WorkspaceModule from 'resource:///org/gnome/shell/ui/workspace.js';
import {WindowPreview} from 'resource:///org/gnome/shell/ui/windowPreview.js';
import {ApplicationWindowOverview} from './appSpread.js';
import {
    APP_GROUP_HEADER_HEIGHT,
    APP_GROUP_STACK_ICON_SIZE,
    WorkspaceAppGroupChrome,
    type AppGroupChromeLayout,
} from './appGroupChrome.js';
import type {ApplicationGroupLayout} from './groupedOverviewLayout.js';
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
import {GroupedOverviewAppearance} from '../common/groupedOverviewAppearance.js';
import {
    GroupedOverviewPresentation,
    type PresentedOverviewPreview,
} from './groupedOverviewPresentation.js';
import type {
    OverviewPreviewIcons,
    IconOverviewPreview,
} from './overviewPreviewIcons.js';

type GnomeWindowPreview = GroupedOverviewPreview<Meta.Window> &
    StackableOverviewPreview &
    PresentedOverviewPreview &
    IconOverviewPreview;

type GnomeWorkspaceModule = {
    WorkspaceLayout?: {
        prototype: GroupedWorkspaceLayoutPrototype<GnomeWindowPreview>;
    };
};

export function createApplicationGroupedOverviewExtension(
    applicationOverview: ApplicationWindowOverview,
    appearance: GroupedOverviewAppearance,
    icons: OverviewPreviewIcons
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
    const presentation = new GroupedOverviewPresentation(message =>
        console.warn(`[touchpad-gesture-customization] ${message}`)
    );
    const chromeByLayout = new Map<
        GroupedWorkspaceLayout<GnomeWindowPreview>,
        WorkspaceAppGroupChrome
    >();
    const pendingChrome = new Map<
        GroupedWorkspaceLayout<GnomeWindowPreview>,
        {
            groups: ApplicationGroupLayout<GnomeWindowPreview>[];
            sourceId: number;
            destroyId: number;
        }
    >();
    const scaleFactor = () =>
        St.ThemeContext.get_for_stage(global.stage).scale_factor;

    const restorePreviewStacking = (previews: GnomeWindowPreview[]) => {
        presentation.restore(previews);
        icons.setGrouped(previews, false);
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
        getGroupHeaderHeight: () =>
            (appearance === GroupedOverviewAppearance.APPLICATION_HEADER
                ? APP_GROUP_HEADER_HEIGHT
                : APP_GROUP_STACK_ICON_SIZE) * scaleFactor(),
        getGroupHeaderPosition: () =>
            appearance === GroupedOverviewAppearance.APPLICATION_HEADER
                ? 'top'
                : 'bottom',
        updateGroupChrome(layout, groups) {
            const pending = pendingChrome.get(layout);

            if (pending !== undefined) {
                pending.groups = groups;
                return;
            }

            if (
                !chromeByLayout.has(layout) &&
                !groups.some(group => group.header !== null)
            )
                return;

            const chromeLayout = layout as unknown as AppGroupChromeLayout;
            const update = {groups, sourceId: 0, destroyId: 0};
            update.sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                pendingChrome.delete(layout);
                chromeLayout._container.disconnect(update.destroyId);

                try {
                    let chrome = chromeByLayout.get(layout);

                    if (
                        chrome === undefined &&
                        update.groups.some(group => group.header !== null)
                    ) {
                        chrome = new WorkspaceAppGroupChrome(
                            chromeLayout,
                            Main.overview._overview._controls._searchController,
                            tracker,
                            appearance,
                            () => chromeByLayout.delete(layout)
                        );
                        chromeByLayout.set(layout, chrome);
                    }

                    if (chrome !== undefined) chrome.update(update.groups);
                } catch (error) {
                    console.error(
                        '[touchpad-gesture-customization] Grouped Overview headers could not be updated',
                        error
                    );
                }

                return GLib.SOURCE_REMOVE;
            });
            update.destroyId = chromeLayout._container.connect(
                'destroy',
                () => {
                    GLib.source_remove(update.sourceId);
                    pendingChrome.delete(layout);
                }
            );
            pendingChrome.set(layout, update);
        },
        destroyGroupChrome() {
            presentation.destroy();

            for (const [layout, pending] of pendingChrome) {
                GLib.source_remove(pending.sourceId);
                (
                    layout as unknown as AppGroupChromeLayout
                )._container.disconnect(pending.destroyId);
            }

            pendingChrome.clear();
            for (const chrome of chromeByLayout.values()) chrome.destroy();

            chromeByLayout.clear();
        },
        setPreviewStacking(previews) {
            icons.setGrouped(previews, true);
            presentation.apply(previews);
            setOverviewPreviewStacking(previews);
        },
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
