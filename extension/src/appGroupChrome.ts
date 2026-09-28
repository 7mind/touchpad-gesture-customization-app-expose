import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {
    AppGroupChromeController,
    type AppGroupLabel,
} from './appGroupChromeController.js';
import type {
    ApplicationGroupLayout,
    LayoutRectangle,
} from './groupedOverviewLayout.js';
import type {GroupedOverviewPreview} from './groupedOverview.js';
import {GroupedOverviewAppearance} from '../common/groupedOverviewAppearance.js';

type AppGroupPreview = GroupedOverviewPreview<Meta.Window>;

export type AppGroupChromeLayout = {
    _container: Clutter.Actor;
    _sortedWindows: AppGroupPreview[];
    _windowSlotsBox: Clutter.ActorBox;
    stateAdjustment: St.Adjustment;
    _overviewAdjustment: St.Adjustment;
};

export type AppGroupSearchController = St.Widget & {searchActive: boolean};

export const APP_GROUP_HEADER_HEIGHT = 36;
export const APP_GROUP_STACK_ICON_SIZE = 64;
const APP_GROUP_ICON_SIZE = 24;

export class ApplicationLabel implements AppGroupLabel<AppGroupPreview> {
    private readonly _actor: St.BoxLayout;
    private readonly _name: St.Label;
    private readonly _tracker: Shell.WindowTracker;
    private _window: Meta.Window | null = null;
    private _app: Shell.App | null = null;
    private _icon: Clutter.Actor | null = null;
    private readonly _appearance: GroupedOverviewAppearance;

    constructor(
        parent: Clutter.Actor,
        tracker: Shell.WindowTracker,
        appearance: GroupedOverviewAppearance
    ) {
        this._tracker = tracker;
        this._appearance = appearance;
        this._actor = new St.BoxLayout({
            style_class: 'gie-app-group-label',
            reactive: false,
            can_focus: false,
        });
        this._name = new St.Label({
            reactive: false,
            can_focus: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._name.clutter_text.single_line_mode = true;
        this._actor.add_child(this._name);
        this._name.visible =
            appearance === GroupedOverviewAppearance.APPLICATION_HEADER;
        parent.add_child(this._actor);
    }

    update(group: ApplicationGroupLayout<AppGroupPreview>): void {
        this._actor.name = group.key;
        const preview = group.items[0];

        if (preview === undefined)
            throw new Error('Application group has no window');

        if (this._window !== preview.metaWindow) {
            this._window = preview.metaWindow;
            const app = this._tracker.get_window_app(
                this._window
            ) as Shell.App | null;

            if (this._icon === null || this._app !== app) {
                if (this._icon !== null) this._icon.destroy();

                this._icon =
                    app === null
                        ? new St.Icon({
                              icon_name: 'application-x-executable-symbolic',
                              icon_size: this._iconSize,
                          })
                        : app.create_icon_texture(this._iconSize);
                this._icon.reactive = false;
                this._icon.y_align = Clutter.ActorAlign.CENTER;
                this._actor.insert_child_at_index(this._icon, 0);
            }

            this._app = app;
        }

        this._name.text =
            this._app === null
                ? preview.metaWindow.get_title()
                : this._app.get_name();
        this._actor.accessible_name = this._name.text;
    }

    setRectangle(rectangle: LayoutRectangle): void {
        const theme = this._actor.get_theme_node();
        const [minimum, natural] =
            this._actor.layout_manager.get_preferred_width(
                this._actor,
                rectangle.height
            );
        const [, naturalWidth] = theme.adjust_preferred_width(minimum, natural);
        const width = Math.min(rectangle.width, naturalWidth);
        this._actor.set_position(
            rectangle.x + (rectangle.width - width) / 2,
            rectangle.y
        );
        this._actor.set_size(width, rectangle.height);
        this._actor.set_clip(0, 0, width, rectangle.height);
    }

    private get _iconSize(): number {
        return this._appearance === GroupedOverviewAppearance.APPLICATION_HEADER
            ? APP_GROUP_ICON_SIZE
            : APP_GROUP_STACK_ICON_SIZE;
    }

    destroy(): void {
        this._actor.destroy();
    }
}

export class WorkspaceAppGroupChrome {
    private readonly _layout: AppGroupChromeLayout;
    private readonly _workspace: Clutter.Actor;
    private readonly _overlay: St.Widget;
    private readonly _search: AppGroupSearchController;
    private readonly _controller: AppGroupChromeController<AppGroupPreview>;
    private readonly _connections: {source: GObject.Object; id: number}[] = [];
    private readonly _onDestroy: () => void;
    private _destroyed = false;
    private _groups: ApplicationGroupLayout<AppGroupPreview>[] = [];

    constructor(
        layout: AppGroupChromeLayout,
        search: AppGroupSearchController,
        tracker: Shell.WindowTracker,
        appearance: GroupedOverviewAppearance,
        onDestroy: () => void
    ) {
        const workspace = layout._container.get_parent();

        if (workspace === null)
            throw new Error('Overview container has no workspace');

        this._layout = layout;
        this._workspace = workspace;
        this._search = search;
        this._onDestroy = onDestroy;
        this._overlay = new St.Widget({
            name: 'gie-app-group-overlay',
            reactive: false,
            can_focus: false,
            x_expand: true,
            y_expand: true,
            min_width: 0,
            min_height: 0,
            natural_width: 0,
            natural_height: 0,
            layout_manager: new Clutter.FixedLayout(),
            opacity: 0,
        });
        workspace.add_child(this._overlay);
        this._controller = new AppGroupChromeController(
            {
                createLabel: () =>
                    new ApplicationLabel(this._overlay, tracker, appearance),
                setOpacity: opacity => {
                    this._overlay.opacity = opacity;
                },
            },
            rectangle => this._transform(rectangle)
        );
        this._connect(layout._container, 'destroy', () => this.destroy());
        this._connect(layout._container, 'child-removed', () =>
            this._syncMembership()
        );
        this._connect(layout._container, 'notify::allocation', () =>
            this._controller.syncGeometry()
        );
        this._connect(this._overlay, 'notify::allocation', () =>
            this._controller.syncGeometry()
        );
        this._connect(layout.stateAdjustment, 'notify::value', () =>
            this._syncState()
        );
        this._connect(layout._overviewAdjustment, 'notify::value', () =>
            this._syncState()
        );
        this._connect(search, 'notify::search-active', () => this._syncState());
    }

    update(groups: ApplicationGroupLayout<AppGroupPreview>[]): void {
        this._groups = groups;
        this._syncMembership();
        this._syncState();
    }

    private _syncMembership(): void {
        const present = new Set(this._layout._sortedWindows);
        this._groups = this._groups
            .map(group => ({
                ...group,
                items: group.items.filter(item => present.has(item)),
            }))
            .filter(group => group.items.length > 0);
        this._controller.update(this._groups);
    }

    destroy(): void {
        if (this._destroyed) return;

        this._destroyed = true;

        for (const {source, id} of this._connections) source.disconnect(id);

        this._connections.length = 0;
        this._controller.destroy();
        this._overlay.destroy();
        this._onDestroy();
    }

    private _connect(
        source: GObject.Object,
        signal: string,
        callback: () => void
    ): void {
        this._connections.push({source, id: source.connect(signal, callback)});
    }

    private _syncState(): void {
        this._controller.setState({
            overviewProgress: this._layout._overviewAdjustment.value,
            spreadProgress: this._layout.stateAdjustment.value,
            searchActive: this._search.searchActive,
        });
    }

    private _transform(rectangle: LayoutRectangle): LayoutRectangle {
        const container = this._layout._container;
        const slotWidth = this._layout._windowSlotsBox.get_width();

        if (slotWidth <= 0)
            throw new RangeError(
                'Application header has no allocated window slots'
            );

        const scale = container.width / slotWidth;
        const first = container.apply_relative_transform_to_point(
            this._workspace,
            new Graphene.Point3D({
                x: rectangle.x * scale,
                y: rectangle.y * scale,
                z: 0,
            })
        );
        const last = container.apply_relative_transform_to_point(
            this._workspace,
            new Graphene.Point3D({
                x: (rectangle.x + rectangle.width) * scale,
                y: (rectangle.y + rectangle.height) * scale,
                z: 0,
            })
        );
        const [overlayX, overlayY] = this._overlay.get_position();

        return {
            x: first.x - overlayX,
            y: first.y - overlayY,
            width: last.x - first.x,
            height: last.y - first.y,
        };
    }
}
