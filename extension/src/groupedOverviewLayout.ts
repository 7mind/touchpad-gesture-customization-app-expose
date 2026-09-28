export type LayoutRectangle = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type GroupedOverviewLayoutOptions = {
    windowLayout: 'spiral' | 'spread';
    groupGap: number;
    groupPadding: number;
    groupHeaderHeight: number;
    groupHeaderPosition: 'top' | 'bottom';
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
    header: LayoutRectangle | null;
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

export class LayoutAreaTooSmallError extends RangeError {}

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
    spiralSlots: IntrinsicWindowSlot<T>[];
};

type IntrinsicWindowSlot<T> = LayoutRectangle & {item: T};

type ExposedWindow = {
    area: number;
    exposedArea: number;
    fragments: LayoutRectangle[];
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
const SPIRAL_ANGLE_STEP = Math.PI / 3;
const SPIRAL_INITIAL_ANGLE = -Math.PI / 2;
const SPIRAL_RADIUS_FRACTION = 0.22;
const MINIMUM_EXPOSED_FRACTION = 0.1;
const EXPOSURE_RESERVE_FRACTION = 0.1;
const SCALE_SEARCH_STEPS = 24;

export function createGroupedOverviewLayoutOptions(
    windowGap: number
): GroupedOverviewLayoutOptions {
    assertNonNegativeFinite(windowGap, 'windowGap');

    return {
        windowLayout: 'spiral',
        groupGap: windowGap * GROUP_GAP_MULTIPLIER,
        groupPadding: windowGap * GROUP_PADDING_MULTIPLIER,
        groupHeaderHeight: 0,
        groupHeaderPosition: 'top',
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
        this._groups = groupWindows(windows, options);
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
            const paddedArea = insetRectangle(
                outerCell.rectangle,
                this._options.groupPadding
            );
            const headerHeight = this._options.groupHeaderHeight;
            const bottomHeader = this._options.groupHeaderPosition === 'bottom';
            const header =
                headerHeight === 0
                    ? null
                    : {
                          ...paddedArea,
                          height: headerHeight,
                      };
            const reservedHeight =
                header === null ? 0 : headerHeight + this._options.groupPadding;
            const innerArea = {
                ...paddedArea,
                y: paddedArea.y + (bottomHeader ? 0 : reservedHeight),
                height: paddedArea.height - reservedHeight,
            };

            if (innerArea.height < MINIMUM_LAYOUT_SIZE)
                throw new LayoutAreaTooSmallError(
                    'Layout area is too small for application headers'
                );

            const innerSlots =
                this._options.windowLayout === 'spiral'
                    ? computeSpiralSlots(
                          group.spiralSlots,
                          innerArea,
                          this._options.maxWindowScale
                      )
                    : computeSpreadSlots(
                          group.windows,
                          innerArea,
                          this._options
                      );
            const items: T[] = [];

            if (header !== null && bottomHeader) {
                const left = Math.min(...innerSlots.map(slot => slot.x));
                const right = Math.max(
                    ...innerSlots.map(slot => slot.x + slot.width)
                );
                header.x = left;
                header.width = right - left;
                header.y =
                    Math.max(...innerSlots.map(slot => slot.y + slot.height)) +
                    this._options.groupPadding;
            }

            for (const slot of innerSlots) {
                items.push(slot.item);
                result.slots.push({
                    ...slot,
                    groupKey: group.key,
                });
            }

            result.groups.push({
                key: group.key,
                items,
                region: outerCell.rectangle,
                header,
                weight: outerCell.item.weight,
            });
        }

        return result;
    }
}

function computeSpiralSlots<T>(
    rectangles: readonly IntrinsicWindowSlot<T>[],
    area: LayoutRectangle,
    maximumScale: number
): IntrinsicWindowSlot<T>[] {
    const bounds = unionRectangles(rectangles);
    const target = fitRectangle(bounds, area, maximumScale);
    const scale = target.width / bounds.width;

    return rectangles.map(rectangle => ({
        item: rectangle.item,
        x: target.x + (rectangle.x - bounds.x) * scale,
        y: target.y + (rectangle.y - bounds.y) * scale,
        width: rectangle.width * scale,
        height: rectangle.height * scale,
    }));
}

function prepareSpiralSlots<T>(
    windows: readonly IndexedWindow<T>[]
): IntrinsicWindowSlot<T>[] {
    const minimumWidth = Math.min(
        ...windows.map(window => window.source.width)
    );
    const minimumHeight = Math.min(
        ...windows.map(window => window.source.height)
    );
    const radiusStep =
        (Math.min(minimumWidth, minimumHeight) * SPIRAL_RADIUS_FRACTION) /
        Math.sqrt(Math.max(1, windows.length - 1));
    const exposed: ExposedWindow[] = [];

    return windows.map((window, index) => {
        const radius = radiusStep * Math.sqrt(index);
        const angle = SPIRAL_INITIAL_ANGLE + (index - 1) * SPIRAL_ANGLE_STEP;
        const centerX = Math.cos(angle) * radius;
        const centerY = Math.sin(angle) * radius;
        const fraction =
            MINIMUM_EXPOSED_FRACTION +
            (EXPOSURE_RESERVE_FRACTION * (windows.length - 1 - index)) /
                Math.max(1, windows.length - 1);
        const rectangleAtScale = (scale: number): LayoutRectangle => ({
            x: centerX - (window.source.width * scale) / 2,
            y: centerY - (window.source.height * scale) / 2,
            width: window.source.width * scale,
            height: window.source.height * scale,
        });

        const preservesExposure = (scale: number): boolean => {
            const candidate = rectangleAtScale(scale);

            return exposed.every(
                previous =>
                    previous.exposedArea -
                        sum(
                            previous.fragments.map(fragment =>
                                intersectionArea(fragment, candidate)
                            )
                        ) >=
                    previous.area * fraction
            );
        };

        let scale = 1;

        if (!preservesExposure(scale)) {
            let upper = scale;

            do {
                upper = scale;
                scale /= 2;

                if (scale === 0)
                    throw new RangeError('Cannot preserve visible window area');
            } while (!preservesExposure(scale));

            for (let step = 0; step < SCALE_SEARCH_STEPS; step++) {
                const candidate = (scale + upper) / 2;

                if (preservesExposure(candidate)) scale = candidate;
                else upper = candidate;
            }
        }

        const rectangle = rectangleAtScale(scale);

        for (const previous of exposed) {
            previous.fragments = previous.fragments.flatMap(fragment =>
                subtractRectangle(fragment, rectangle)
            );
            previous.exposedArea = sum(
                previous.fragments.map(
                    fragment => fragment.width * fragment.height
                )
            );
        }

        exposed.push({
            area: rectangle.width * rectangle.height,
            exposedArea: rectangle.width * rectangle.height,
            fragments: [rectangle],
        });

        return {
            ...rectangle,
            item: window.item,
        };
    });
}

function intersectionArea(
    first: LayoutRectangle,
    second: LayoutRectangle
): number {
    return (
        Math.max(
            0,
            Math.min(first.x + first.width, second.x + second.width) -
                Math.max(first.x, second.x)
        ) *
        Math.max(
            0,
            Math.min(first.y + first.height, second.y + second.height) -
                Math.max(first.y, second.y)
        )
    );
}

function subtractRectangle(
    source: LayoutRectangle,
    cover: LayoutRectangle
): LayoutRectangle[] {
    if (intersectionArea(source, cover) === 0) return [source];

    const left = Math.max(source.x, cover.x);
    const top = Math.max(source.y, cover.y);
    const right = Math.min(source.x + source.width, cover.x + cover.width);
    const bottom = Math.min(source.y + source.height, cover.y + cover.height);

    return [
        {x: source.x, y: source.y, width: source.width, height: top - source.y},
        {
            x: source.x,
            y: bottom,
            width: source.width,
            height: source.y + source.height - bottom,
        },
        {x: source.x, y: top, width: left - source.x, height: bottom - top},
        {
            x: right,
            y: top,
            width: source.x + source.width - right,
            height: bottom - top,
        },
    ].filter(rectangle => rectangle.width > 0 && rectangle.height > 0);
}

function computeSpreadSlots<T>(
    windows: readonly IndexedWindow<T>[],
    area: LayoutRectangle,
    options: GroupedOverviewLayoutOptions
): (LayoutRectangle & {item: T})[] {
    const cells = computeSpatialCells(
        windows.map(window => createWindowSpatialItem(window)),
        area,
        options.windowGap,
        options.spatialWeight
    );

    return cells.map(cell => ({
        ...fitRectangle(
            cell.item.item.source,
            cell.rectangle,
            options.maxWindowScale
        ),
        item: cell.item.item.item,
    }));
}

function groupWindows<T>(
    windows: readonly GroupedOverviewWindow<T>[],
    options: GroupedOverviewLayoutOptions
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
        weight:
            1 +
            options.groupCountFactor * (Math.sqrt(group.windows.length) - 1),
        spiralSlots:
            options.windowLayout === 'spiral'
                ? prepareSpiralSlots(group.windows)
                : [],
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
        throw new LayoutAreaTooSmallError(
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
    if (options.windowLayout !== 'spiral' && options.windowLayout !== 'spread')
        throw new TypeError('Unknown grouped Overview window layout');

    assertNonNegativeFinite(options.groupGap, 'options.groupGap');
    assertNonNegativeFinite(options.groupPadding, 'options.groupPadding');
    assertNonNegativeFinite(
        options.groupHeaderHeight,
        'options.groupHeaderHeight'
    );
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
