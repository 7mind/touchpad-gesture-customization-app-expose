export type LayoutRectangle = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type GroupedOverviewLayoutOptions = {
    groupGap: number;
    groupPadding: number;
    windowGap: number;
    maxWindowScale: number;
    groupCountFactor: number;
    spatialWeight: number;
};

export type GroupedOverviewWindow<T> = {
    item: T;
    groupKey: string | null;
    source: LayoutRectangle;
};

export type ApplicationGroupLayout<T> = {
    key: string;
    items: T[];
    region: LayoutRectangle;
    weight: number;
};

export type GroupedWindowSlot<T> = LayoutRectangle & {
    item: T;
    groupKey: string;
};

export type GroupedOverviewLayout<T> = {
    groups: ApplicationGroupLayout<T>[];
    slots: GroupedWindowSlot<T>[];
};

type IndexedWindow<T> = GroupedOverviewWindow<T> & {
    sequence: number;
};

type MutableApplicationGroup<T> = {
    key: string;
    windows: IndexedWindow<T>[];
    sequence: number;
};

type PreparedApplicationGroup<T> = MutableApplicationGroup<T> & {
    weight: number;
};

type SpatialItem<T> = {
    item: T;
    sequence: number;
    weight: number;
    preferredAspect: number;
    anchorX: number;
    anchorY: number;
};

type SpatialCell<T> = {
    item: SpatialItem<T>;
    rectangle: LayoutRectangle;
};

type SpatialCandidate<T> = {
    cells: SpatialCell<T>[];
    score: number;
    rowCount: number;
};

const GROUP_GAP_MULTIPLIER = 2;
const GROUP_PADDING_MULTIPLIER = 0.5;
const MAX_WINDOW_SCALE = 0.95;
const GROUP_COUNT_FACTOR = 0.75;
const SPATIAL_WEIGHT = 0.35;
const MINIMUM_GROUP_ASPECT = 0.6;
const MAXIMUM_GROUP_ASPECT = 2.4;
const MINIMUM_LAYOUT_SIZE = 1;
const SCORE_TOLERANCE = 1e-12;

export function createGroupedOverviewLayoutOptions(
    windowGap: number
): GroupedOverviewLayoutOptions {
    assertNonNegativeFinite(windowGap, 'windowGap');

    return {
        groupGap: windowGap * GROUP_GAP_MULTIPLIER,
        groupPadding: windowGap * GROUP_PADDING_MULTIPLIER,
        windowGap,
        maxWindowScale: MAX_WINDOW_SCALE,
        groupCountFactor: GROUP_COUNT_FACTOR,
        spatialWeight: SPATIAL_WEIGHT,
    };
}

export function layoutWindowsByApplication<T>(
    windows: readonly GroupedOverviewWindow<T>[],
    area: LayoutRectangle,
    options: GroupedOverviewLayoutOptions
): GroupedOverviewLayout<T> {
    return new GroupedOverviewLayoutEngine(windows, options).layout(area);
}

export class GroupedOverviewLayoutEngine<T> {
    private readonly _groups: PreparedApplicationGroup<T>[];
    private readonly _options: GroupedOverviewLayoutOptions;

    constructor(
        windows: readonly GroupedOverviewWindow<T>[],
        options: GroupedOverviewLayoutOptions
    ) {
        validateOptions(options);
        this._groups = groupWindows(windows, options.groupCountFactor);
        this._options = {...options};
    }

    layout(area: LayoutRectangle): GroupedOverviewLayout<T> {
        validateRectangle(area, 'area');

        if (this._groups.length === 0) return {groups: [], slots: []};

        const outerItems = this._groups.map(group =>
            createGroupSpatialItem(group)
        );
        const outerCells = computeSpatialCells(
            outerItems,
            area,
            this._options.groupGap,
            this._options.spatialWeight
        );
        const result: GroupedOverviewLayout<T> = {groups: [], slots: []};

        for (const outerCell of outerCells) {
            const group = outerCell.item.item;
            const innerArea = insetRectangle(
                outerCell.rectangle,
                this._options.groupPadding
            );
            const innerItems = group.windows.map(window =>
                createWindowSpatialItem(window)
            );
            const innerCells = computeSpatialCells(
                innerItems,
                innerArea,
                this._options.windowGap,
                this._options.spatialWeight
            );
            const items: T[] = [];

            for (const innerCell of innerCells) {
                const window = innerCell.item.item;
                const slot = fitRectangle(
                    window.source,
                    innerCell.rectangle,
                    this._options.maxWindowScale
                );

                items.push(window.item);
                result.slots.push({
                    ...slot,
                    item: window.item,
                    groupKey: group.key,
                });
            }

            result.groups.push({
                key: group.key,
                items,
                region: outerCell.rectangle,
                weight: outerCell.item.weight,
            });
        }

        return result;
    }
}

function groupWindows<T>(
    windows: readonly GroupedOverviewWindow<T>[],
    groupCountFactor: number
): PreparedApplicationGroup<T>[] {
    const knownKeys = new Set(
        windows
            .map(window => window.groupKey)
            .filter((key): key is string => key !== null)
    );
    const groupsByKey = new Map<string, MutableApplicationGroup<T>>();

    windows.forEach((window, sequence) => {
        validateRectangle(window.source, `windows[${sequence}].source`);
        const key =
            window.groupKey === null
                ? createUnmatchedGroupKey(sequence, knownKeys, groupsByKey)
                : window.groupKey;
        const indexedWindow: IndexedWindow<T> = {
            ...window,
            source: {...window.source},
            sequence,
        };
        const group = groupsByKey.get(key);

        if (group === undefined) {
            groupsByKey.set(key, {
                key,
                windows: [indexedWindow],
                sequence,
            });
        } else {
            group.windows.push(indexedWindow);
        }
    });

    return Array.from(groupsByKey.values()).map(group => ({
        ...group,
        weight: 1 + groupCountFactor * (Math.sqrt(group.windows.length) - 1),
    }));
}

function createUnmatchedGroupKey<T>(
    sequence: number,
    knownKeys: ReadonlySet<string>,
    groupsByKey: ReadonlyMap<string, MutableApplicationGroup<T>>
): string {
    let key = `unmatched-window:${sequence}`;

    while (knownKeys.has(key) || groupsByKey.has(key)) key = `${key}:fallback`;

    return key;
}

function createGroupSpatialItem<T>(
    group: PreparedApplicationGroup<T>
): SpatialItem<PreparedApplicationGroup<T>> {
    const union = unionRectangles(group.windows.map(window => window.source));
    let weightedX = 0;
    let weightedY = 0;
    let totalArea = 0;

    for (const window of group.windows) {
        const windowArea = window.source.width * window.source.height;
        weightedX += (window.source.x + window.source.width / 2) * windowArea;
        weightedY += (window.source.y + window.source.height / 2) * windowArea;
        totalArea += windowArea;
    }

    return {
        item: group,
        sequence: group.sequence,
        weight: group.weight,
        preferredAspect: clamp(
            union.width / union.height,
            MINIMUM_GROUP_ASPECT,
            MAXIMUM_GROUP_ASPECT
        ),
        anchorX: weightedX / totalArea,
        anchorY: weightedY / totalArea,
    };
}

function createWindowSpatialItem<T>(
    window: IndexedWindow<T>
): SpatialItem<IndexedWindow<T>> {
    return {
        item: window,
        sequence: window.sequence,
        weight: 1,
        preferredAspect: window.source.width / window.source.height,
        anchorX: window.source.x + window.source.width / 2,
        anchorY: window.source.y + window.source.height / 2,
    };
}

function computeSpatialCells<T>(
    items: readonly SpatialItem<T>[],
    area: LayoutRectangle,
    gap: number,
    spatialWeight: number
): SpatialCell<T>[] {
    if (items.length === 0) return [];
    if (items.length === 1) return [{item: items[0], rectangle: {...area}}];

    let bestCandidate: SpatialCandidate<T> | null = null;

    for (let rowCount = 1; rowCount <= items.length; rowCount++) {
        const candidate = createSpatialCandidate(
            items,
            area,
            gap,
            spatialWeight,
            rowCount
        );

        if (candidate === null) continue;

        const improvesScore =
            bestCandidate === null ||
            candidate.score < bestCandidate.score - SCORE_TOLERANCE;
        const resolvesTie =
            bestCandidate !== null &&
            Math.abs(candidate.score - bestCandidate.score) <=
                SCORE_TOLERANCE &&
            candidate.rowCount < bestCandidate.rowCount;

        if (improvesScore || resolvesTie) bestCandidate = candidate;
    }

    if (bestCandidate === null)
        throw new RangeError(
            'Layout area is too small for the configured gaps'
        );

    return bestCandidate.cells;
}

function createSpatialCandidate<T>(
    items: readonly SpatialItem<T>[],
    area: LayoutRectangle,
    gap: number,
    spatialWeight: number,
    rowCount: number
): SpatialCandidate<T> | null {
    const usableHeight = area.height - gap * (rowCount - 1);

    if (usableHeight <= 0) return null;

    const rows = partitionRows(items, rowCount);
    const totalWeight = sum(items.map(item => item.weight));
    const cells: SpatialCell<T>[] = [];
    let y = area.y;

    for (const row of rows) {
        const rowWeight = sum(row.map(item => item.weight));
        const rowHeight = (usableHeight * rowWeight) / totalWeight;
        const sortedRow = row
            .slice()
            .sort(
                (left, right) =>
                    left.anchorX - right.anchorX ||
                    left.sequence - right.sequence
            );
        const usableWidth = area.width - gap * (sortedRow.length - 1);

        if (usableWidth <= 0) return null;

        let x = area.x;

        for (const item of sortedRow) {
            const width = (usableWidth * item.weight) / rowWeight;

            cells.push({
                item,
                rectangle: {x, y, width, height: rowHeight},
            });
            x += width + gap;
        }

        y += rowHeight + gap;
    }

    return {
        cells,
        score: scoreCells(cells, area, spatialWeight),
        rowCount,
    };
}

function partitionRows<T>(
    items: readonly SpatialItem<T>[],
    rowCount: number
): SpatialItem<T>[][] {
    const sortedItems = items
        .slice()
        .sort(
            (left, right) =>
                left.anchorY - right.anchorY || left.sequence - right.sequence
        );
    const rows: SpatialItem<T>[][] = [];
    let itemIndex = 0;
    let remainingWeight = sum(sortedItems.map(item => item.weight));

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const remainingRows = rowCount - rowIndex;
        const maximumItems =
            sortedItems.length - itemIndex - (remainingRows - 1);
        const targetWeight = remainingWeight / remainingRows;
        const row: SpatialItem<T>[] = [];
        let rowWeight = 0;

        while (row.length < maximumItems) {
            const candidate = sortedItems[itemIndex];
            const currentDifference = Math.abs(targetWeight - rowWeight);
            const nextDifference = Math.abs(
                targetWeight - rowWeight - candidate.weight
            );

            if (row.length > 0 && currentDifference < nextDifference) break;

            row.push(candidate);
            rowWeight += candidate.weight;
            itemIndex++;
        }

        if (row.length === 0) {
            const candidate = sortedItems[itemIndex];

            row.push(candidate);
            rowWeight = candidate.weight;
            itemIndex++;
        }

        rows.push(row);
        remainingWeight -= rowWeight;
    }

    return rows;
}

function scoreCells<T>(
    cells: readonly SpatialCell<T>[],
    area: LayoutRectangle,
    spatialWeight: number
): number {
    const totalWeight = sum(cells.map(cell => cell.item.weight));
    const anchorBounds = getAnchorBounds(cells.map(cell => cell.item));
    let aspectError = 0;
    let positionError = 0;

    for (const cell of cells) {
        const rectangleAspect = cell.rectangle.width / cell.rectangle.height;
        const aspectRatio = rectangleAspect / cell.item.preferredAspect;
        const targetX =
            (cell.rectangle.x + cell.rectangle.width / 2 - area.x) / area.width;
        const targetY =
            (cell.rectangle.y + cell.rectangle.height / 2 - area.y) /
            area.height;
        const sourceX = normalizeAnchor(
            cell.item.anchorX,
            anchorBounds.minX,
            anchorBounds.maxX
        );
        const sourceY = normalizeAnchor(
            cell.item.anchorY,
            anchorBounds.minY,
            anchorBounds.maxY
        );
        const distanceSquared =
            (targetX - sourceX) ** 2 + (targetY - sourceY) ** 2;

        aspectError += Math.abs(Math.log(aspectRatio)) * cell.item.weight;
        positionError += distanceSquared * cell.item.weight;
    }

    return (
        aspectError / totalWeight +
        (positionError / totalWeight) * spatialWeight
    );
}

function getAnchorBounds<T>(items: readonly SpatialItem<T>[]) {
    return {
        minX: Math.min(...items.map(item => item.anchorX)),
        maxX: Math.max(...items.map(item => item.anchorX)),
        minY: Math.min(...items.map(item => item.anchorY)),
        maxY: Math.max(...items.map(item => item.anchorY)),
    };
}

function normalizeAnchor(value: number, minimum: number, maximum: number) {
    if (minimum === maximum) return 0.5;
    return (value - minimum) / (maximum - minimum);
}

function unionRectangles(
    rectangles: readonly LayoutRectangle[]
): LayoutRectangle {
    const x = Math.min(...rectangles.map(rectangle => rectangle.x));
    const y = Math.min(...rectangles.map(rectangle => rectangle.y));
    const x2 = Math.max(
        ...rectangles.map(rectangle => rectangle.x + rectangle.width)
    );
    const y2 = Math.max(
        ...rectangles.map(rectangle => rectangle.y + rectangle.height)
    );

    return {x, y, width: x2 - x, height: y2 - y};
}

function insetRectangle(
    rectangle: LayoutRectangle,
    requestedPadding: number
): LayoutRectangle {
    const maximumPadding = Math.max(
        0,
        Math.min(
            (rectangle.width - MINIMUM_LAYOUT_SIZE) / 2,
            (rectangle.height - MINIMUM_LAYOUT_SIZE) / 2
        )
    );
    const padding = Math.min(requestedPadding, maximumPadding);

    return {
        x: rectangle.x + padding,
        y: rectangle.y + padding,
        width: rectangle.width - padding * 2,
        height: rectangle.height - padding * 2,
    };
}

function fitRectangle(
    source: LayoutRectangle,
    target: LayoutRectangle,
    maximumScale: number
): LayoutRectangle {
    const scale = Math.min(
        target.width / source.width,
        target.height / source.height,
        maximumScale
    );
    const width = source.width * scale;
    const height = source.height * scale;

    return {
        x: target.x + (target.width - width) / 2,
        y: target.y + (target.height - height) / 2,
        width,
        height,
    };
}

function validateOptions(options: GroupedOverviewLayoutOptions): void {
    assertNonNegativeFinite(options.groupGap, 'options.groupGap');
    assertNonNegativeFinite(options.groupPadding, 'options.groupPadding');
    assertNonNegativeFinite(options.windowGap, 'options.windowGap');
    assertPositiveFinite(options.maxWindowScale, 'options.maxWindowScale');
    assertNonNegativeFinite(
        options.groupCountFactor,
        'options.groupCountFactor'
    );
    assertNonNegativeFinite(options.spatialWeight, 'options.spatialWeight');
}

function validateRectangle(rectangle: LayoutRectangle, name: string): void {
    assertFinite(rectangle.x, `${name}.x`);
    assertFinite(rectangle.y, `${name}.y`);
    assertPositiveFinite(rectangle.width, `${name}.width`);
    assertPositiveFinite(rectangle.height, `${name}.height`);
}

function assertFinite(value: number, name: string): void {
    if (!Number.isFinite(value))
        throw new RangeError(`${name} must be a finite number`);
}

function assertPositiveFinite(value: number, name: string): void {
    assertFinite(value, name);
    if (value <= 0) throw new RangeError(`${name} must be greater than zero`);
}

function assertNonNegativeFinite(value: number, name: string): void {
    assertFinite(value, name);
    if (value < 0) throw new RangeError(`${name} must not be negative`);
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}

function sum(values: readonly number[]): number {
    return values.reduce((total, value) => total + value, 0);
}
