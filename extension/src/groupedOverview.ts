import {
    createGroupedOverviewLayoutOptions,
    GroupedOverviewLayoutEngine,
    LayoutAreaTooSmallError,
    type ApplicationGroupLayout,
    type GroupedOverviewWindow,
    type LayoutRectangle,
} from './groupedOverviewLayout.js';

export type GroupedOverviewPreview<TWindow> = {
    metaWindow: TWindow;
    boundingBox: LayoutRectangle;
};

export type WorkspaceWindowSlot<TPreview> = [
    x: number,
    y: number,
    width: number,
    height: number,
    preview: TPreview,
];

type WorkspaceLayoutStrategy<TPreview> = {
    computeWindowSlots(
        layout: unknown,
        area: LayoutRectangle
    ): WorkspaceWindowSlot<TPreview>[];
};

export type GroupedWorkspaceLayout<TPreview> = {
    _spacing: number;
    _sortedWindows: TPreview[];
    _layoutStrategy: WorkspaceLayoutStrategy<TPreview>;
    _adjustSpacingAndPadding(
        rowSpacing: number | null,
        columnSpacing: number | null,
        containerBox: unknown | null
    ): [number | null, number | null, unknown | null];
};

type CreateBestLayout<TPreview> = (
    this: GroupedWorkspaceLayout<TPreview>,
    area: LayoutRectangle
) => unknown;

type GetWindowSlots<TPreview> = (
    this: GroupedWorkspaceLayout<TPreview>,
    containerBox: unknown
) => WorkspaceWindowSlot<TPreview>[];

type SyncStacking<TPreview> = (
    this: GroupedWorkspaceLayout<TPreview>,
    stackIndices: Readonly<Record<number, number>>
) => void;

type AdjustSpacingAndPadding<TPreview> =
    GroupedWorkspaceLayout<TPreview>['_adjustSpacingAndPadding'];

function isPendingAllocation(rectangle: LayoutRectangle): boolean {
    return (
        Number.isFinite(rectangle.x) &&
        Number.isFinite(rectangle.y) &&
        Number.isFinite(rectangle.width) &&
        Number.isFinite(rectangle.height) &&
        rectangle.width >= 0 &&
        rectangle.height >= 0 &&
        (rectangle.width === 0 || rectangle.height === 0)
    );
}

export type GroupedWorkspaceLayoutPrototype<TPreview> = {
    _createBestLayout?: CreateBestLayout<TPreview>;
    _getWindowSlots?: GetWindowSlots<TPreview>;
    _adjustSpacingAndPadding?: AdjustSpacingAndPadding<TPreview>;
    syncStacking?: SyncStacking<TPreview>;
};

export type ApplicationGroupedOverviewDependencies<TPreview, TWindow> = {
    workspaceLayoutPrototype: GroupedWorkspaceLayoutPrototype<TPreview> | null;
    resolveAppKey(window: TWindow): string | null;
    resolveFallbackSource(window: TWindow): LayoutRectangle;
    isApplicationOverviewActive(): boolean;
    getGroupHeaderHeight(): number;
    getGroupHeaderPosition(): 'top' | 'bottom';
    updateGroupChrome(
        layout: GroupedWorkspaceLayout<TPreview>,
        groups: ApplicationGroupLayout<TPreview>[]
    ): void;
    destroyGroupChrome(): void;
    setPreviewStacking(previews: TPreview[]): void;
    restorePreviewStacking(previews: TPreview[]): void;
    restoreStacking(): void;
    invalidateLayouts(): void;
    report(message: string, error: unknown | null): void;
};

class ApplicationGroupedLayoutStrategy<
    TPreview extends GroupedOverviewPreview<TWindow>,
    TWindow,
> implements WorkspaceLayoutStrategy<TPreview>
{
    private readonly _fallbackStrategy: WorkspaceLayoutStrategy<TPreview>;
    private readonly _fallbackLayout: unknown;
    private readonly _report: (message: string, error: unknown | null) => void;
    private readonly _enabled: () => boolean;
    private readonly _setStacking: (previews: TPreview[]) => void;
    private readonly _restoreStacking: () => void;
    private readonly _publishGroups: (
        groups: ApplicationGroupLayout<TPreview>[]
    ) => void;

    constructor(
        fallbackStrategy: WorkspaceLayoutStrategy<TPreview>,
        fallbackLayout: unknown,
        report: (message: string, error: unknown | null) => void,
        enabled: () => boolean,
        setStacking: (previews: TPreview[]) => void,
        restoreStacking: () => void,
        publishGroups: (groups: ApplicationGroupLayout<TPreview>[]) => void
    ) {
        this._fallbackStrategy = fallbackStrategy;
        this._fallbackLayout = fallbackLayout;
        this._report = report;
        this._enabled = enabled;
        this._setStacking = setStacking;
        this._restoreStacking = restoreStacking;
        this._publishGroups = publishGroups;
    }

    computeWindowSlots(
        layout: unknown,
        area: LayoutRectangle
    ): WorkspaceWindowSlot<TPreview>[] {
        if (!this._enabled())
            return this._fallbackStrategy.computeWindowSlots(
                this._fallbackLayout,
                area
            );

        try {
            if (!(layout instanceof GroupedOverviewLayoutEngine))
                throw new TypeError('Missing grouped Overview layout engine');

            const groupedLayout = layout.layout(area);

            const slots: WorkspaceWindowSlot<TPreview>[] =
                groupedLayout.slots.map(slot => [
                    slot.x,
                    slot.y,
                    slot.width,
                    slot.height,
                    slot.item,
                ]);
            this._setStacking(slots.map(slot => slot[4]));
            this._publishGroups(groupedLayout.groups);
            return slots;
        } catch (error) {
            this._restoreStacking();
            if (!(error instanceof LayoutAreaTooSmallError))
                this._report(
                    'Grouped Overview slot calculation failed; using the stock layout',
                    error
                );
            return this._fallbackStrategy.computeWindowSlots(
                this._fallbackLayout,
                area
            );
        }
    }
}

export class ApplicationGroupedOverviewExtension<
    TPreview extends GroupedOverviewPreview<TWindow>,
    TWindow,
> {
    private readonly _dependencies: ApplicationGroupedOverviewDependencies<
        TPreview,
        TWindow
    >;
    private _originalCreateBestLayout: CreateBestLayout<TPreview> | null = null;
    private _installedCreateBestLayout: CreateBestLayout<TPreview> | null =
        null;
    private _originalSyncStacking: SyncStacking<TPreview> | null = null;
    private _installedSyncStacking: SyncStacking<TPreview> | null = null;
    private _patchState: {enabled: boolean} | null = null;

    constructor(
        dependencies: ApplicationGroupedOverviewDependencies<TPreview, TWindow>
    ) {
        this._dependencies = dependencies;
    }

    get supported(): boolean {
        const prototype = this._dependencies.workspaceLayoutPrototype;

        return (
            prototype !== null &&
            typeof prototype._createBestLayout === 'function' &&
            typeof prototype._getWindowSlots === 'function' &&
            typeof prototype._adjustSpacingAndPadding === 'function' &&
            typeof prototype.syncStacking === 'function'
        );
    }

    apply(): void {
        if (this._installedCreateBestLayout !== null)
            throw new Error(
                'Grouped Overview layout patch is already installed'
            );

        const prototype = this._dependencies.workspaceLayoutPrototype;

        if (!this.supported || prototype === null) {
            this._dependencies.report(
                'Grouped Overview is unsupported by this GNOME Shell build; using the stock layout',
                null
            );
            return;
        }

        const originalCreateBestLayout = prototype._createBestLayout;
        const originalSyncStacking = prototype.syncStacking;

        if (typeof originalCreateBestLayout !== 'function')
            throw new Error('Missing stock Overview layout method');
        if (typeof originalSyncStacking !== 'function')
            throw new Error('Missing stock Overview stacking method');

        const dependencies = this._dependencies;
        const patchState = {enabled: true};
        const stackingByLayout = new WeakMap<
            GroupedWorkspaceLayout<TPreview>,
            TPreview[]
        >();

        const restoreStacking = (layout: GroupedWorkspaceLayout<TPreview>) => {
            dependencies.updateGroupChrome(layout, []);
            if (!stackingByLayout.delete(layout)) return;
            dependencies.restorePreviewStacking(layout._sortedWindows);
        };

        const installedCreateBestLayout: CreateBestLayout<TPreview> = function (
            area
        ) {
            const fallbackLayout = originalCreateBestLayout.call(this, area);
            const fallbackStrategy = this._layoutStrategy;

            if (!patchState.enabled) return fallbackLayout;

            try {
                if (
                    fallbackStrategy === null ||
                    typeof fallbackStrategy.computeWindowSlots !== 'function'
                )
                    throw new Error('Missing stock Overview layout strategy');

                const [rowSpacing, columnSpacing] =
                    this._adjustSpacingAndPadding(
                        this._spacing,
                        this._spacing,
                        null
                    );

                if (
                    typeof rowSpacing !== 'number' ||
                    typeof columnSpacing !== 'number'
                )
                    throw new Error('Missing Overview layout spacing');

                const options = createGroupedOverviewLayoutOptions(
                    Math.max(rowSpacing, columnSpacing)
                );
                options.windowLayout =
                    dependencies.isApplicationOverviewActive()
                        ? 'spread'
                        : 'spiral';
                options.groupHeaderHeight =
                    options.windowLayout === 'spiral'
                        ? dependencies.getGroupHeaderHeight()
                        : 0;
                options.groupHeaderPosition =
                    dependencies.getGroupHeaderPosition();
                if (options.windowLayout === 'spread') restoreStacking(this);
                const windows: GroupedOverviewWindow<TPreview>[] =
                    this._sortedWindows.map(preview => {
                        const source = {
                            x: preview.boundingBox.x,
                            y: preview.boundingBox.y,
                            width: preview.boundingBox.width,
                            height: preview.boundingBox.height,
                        };

                        return {
                            item: preview,
                            groupKey: dependencies.resolveAppKey(
                                preview.metaWindow
                            ),
                            source: isPendingAllocation(source)
                                ? dependencies.resolveFallbackSource(
                                      preview.metaWindow
                                  )
                                : source,
                        };
                    });

                if (
                    windows.length === 0 ||
                    windows.some(window => isPendingAllocation(window.source))
                ) {
                    restoreStacking(this);
                    this._layoutStrategy = fallbackStrategy;
                    return fallbackLayout;
                }

                const groupedLayout = new GroupedOverviewLayoutEngine(
                    windows,
                    options
                );

                this._layoutStrategy = new ApplicationGroupedLayoutStrategy(
                    fallbackStrategy,
                    fallbackLayout,
                    dependencies.report,
                    () => patchState.enabled,
                    previews => {
                        if (options.windowLayout === 'spread') return;
                        stackingByLayout.set(this, previews);
                        dependencies.setPreviewStacking(previews);
                    },
                    () => restoreStacking(this),
                    groups => dependencies.updateGroupChrome(this, groups)
                );

                return groupedLayout;
            } catch (error) {
                restoreStacking(this);
                this._layoutStrategy = fallbackStrategy;
                dependencies.report(
                    'Grouped Overview layout initialization failed; using the stock layout',
                    error
                );
                return fallbackLayout;
            }
        };

        const installedSyncStacking: SyncStacking<TPreview> = function (
            stackIndices
        ) {
            originalSyncStacking.call(this, stackIndices);
            if (!patchState.enabled) return;

            const previews = stackingByLayout.get(this);
            if (previews !== undefined)
                dependencies.setPreviewStacking(
                    previews.filter(preview =>
                        this._sortedWindows.includes(preview)
                    )
                );
        };

        this._patchState = patchState;
        this._originalCreateBestLayout = originalCreateBestLayout;
        this._installedCreateBestLayout = installedCreateBestLayout;
        this._originalSyncStacking = originalSyncStacking;
        this._installedSyncStacking = installedSyncStacking;
        prototype._createBestLayout = installedCreateBestLayout;
        prototype.syncStacking = installedSyncStacking;
        this._invalidateLayouts(
            'Grouped Overview was installed, but live layouts could not be invalidated'
        );
    }

    destroy(): void {
        this._dependencies.destroyGroupChrome();
        const prototype = this._dependencies.workspaceLayoutPrototype;
        const installedCreateBestLayout = this._installedCreateBestLayout;
        const originalCreateBestLayout = this._originalCreateBestLayout;
        const installedSyncStacking = this._installedSyncStacking;
        const originalSyncStacking = this._originalSyncStacking;

        if (
            prototype === null ||
            installedCreateBestLayout === null ||
            originalCreateBestLayout === null ||
            installedSyncStacking === null ||
            originalSyncStacking === null
        )
            return;

        if (this._patchState === null)
            throw new Error('Missing grouped Overview patch state');
        this._patchState.enabled = false;
        this._patchState = null;

        if (prototype.syncStacking === installedSyncStacking) {
            prototype.syncStacking = originalSyncStacking;

            try {
                this._dependencies.restoreStacking();
            } catch (error) {
                this._dependencies.report(
                    'Grouped Overview was removed, but preview stacking could not be restored',
                    error
                );
            }
        } else {
            this._dependencies.report(
                'Another extension replaced the Overview stacking patch; its method was left intact',
                null
            );
        }

        if (prototype._createBestLayout === installedCreateBestLayout) {
            prototype._createBestLayout = originalCreateBestLayout;
            this._invalidateLayouts(
                'Grouped Overview was removed, but live layouts could not be invalidated'
            );
        } else {
            this._dependencies.report(
                'Another extension replaced the Overview layout patch; its method was left intact',
                null
            );
        }

        this._originalCreateBestLayout = null;
        this._installedCreateBestLayout = null;
        this._originalSyncStacking = null;
        this._installedSyncStacking = null;
    }

    private _invalidateLayouts(failureMessage: string): void {
        try {
            this._dependencies.invalidateLayouts();
        } catch (error) {
            this._dependencies.report(failureMessage, error);
        }
    }
}
