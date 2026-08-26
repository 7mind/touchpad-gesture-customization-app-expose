import {
    createGroupedOverviewLayoutOptions,
    GroupedOverviewLayoutEngine,
    LayoutAreaTooSmallError,
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
};

export type ApplicationGroupedOverviewDependencies<TPreview, TWindow> = {
    workspaceLayoutPrototype: GroupedWorkspaceLayoutPrototype<TPreview> | null;
    resolveAppKey(window: TWindow): string | null;
    resolveFallbackSource(window: TWindow): LayoutRectangle;
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

    constructor(
        fallbackStrategy: WorkspaceLayoutStrategy<TPreview>,
        fallbackLayout: unknown,
        report: (message: string, error: unknown | null) => void
    ) {
        this._fallbackStrategy = fallbackStrategy;
        this._fallbackLayout = fallbackLayout;
        this._report = report;
    }

    computeWindowSlots(
        layout: unknown,
        area: LayoutRectangle
    ): WorkspaceWindowSlot<TPreview>[] {
        try {
            if (!(layout instanceof GroupedOverviewLayoutEngine))
                throw new TypeError('Missing grouped Overview layout engine');

            const groupedLayout = layout.layout(area);

            return groupedLayout.slots.map(slot => [
                slot.x,
                slot.y,
                slot.width,
                slot.height,
                slot.item,
            ]);
        } catch (error) {
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
            typeof prototype._adjustSpacingAndPadding === 'function'
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

        if (typeof originalCreateBestLayout !== 'function')
            throw new Error('Missing stock Overview layout method');

        const dependencies = this._dependencies;

        const installedCreateBestLayout: CreateBestLayout<TPreview> = function (
            area
        ) {
            const fallbackLayout = originalCreateBestLayout.call(this, area);
            const fallbackStrategy = this._layoutStrategy;

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
                    windows.some(window => isPendingAllocation(window.source))
                ) {
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
                    dependencies.report
                );

                return groupedLayout;
            } catch (error) {
                this._layoutStrategy = fallbackStrategy;
                dependencies.report(
                    'Grouped Overview layout initialization failed; using the stock layout',
                    error
                );
                return fallbackLayout;
            }
        };

        this._originalCreateBestLayout = originalCreateBestLayout;
        this._installedCreateBestLayout = installedCreateBestLayout;
        prototype._createBestLayout = installedCreateBestLayout;
        this._invalidateLayouts(
            'Grouped Overview was installed, but live layouts could not be invalidated'
        );
    }

    destroy(): void {
        const prototype = this._dependencies.workspaceLayoutPrototype;
        const installedCreateBestLayout = this._installedCreateBestLayout;
        const originalCreateBestLayout = this._originalCreateBestLayout;

        if (
            prototype === null ||
            installedCreateBestLayout === null ||
            originalCreateBestLayout === null
        )
            return;

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
    }

    private _invalidateLayouts(failureMessage: string): void {
        try {
            this._dependencies.invalidateLayouts();
        } catch (error) {
            this._dependencies.report(failureMessage, error);
        }
    }
}
