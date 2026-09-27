import type {
    ApplicationGroupLayout,
    LayoutRectangle,
} from './groupedOverviewLayout.js';

export type AppGroupLabel<T> = {
    update(group: ApplicationGroupLayout<T>): void;
    setRectangle(rectangle: LayoutRectangle): void;
    destroy(): void;
};

export type AppGroupChromeView<T> = {
    createLabel(group: ApplicationGroupLayout<T>): AppGroupLabel<T>;
    setOpacity(opacity: number): void;
};

export type AppGroupChromeState = {
    overviewProgress: number;
    spreadProgress: number;
    searchActive: boolean;
};

const MAX_OPACITY = 255;
const WINDOW_PICKER_STATE = 1;

export class AppGroupChromeController<T> {
    private readonly _view: AppGroupChromeView<T>;
    private readonly _transform: (
        rectangle: LayoutRectangle
    ) => LayoutRectangle;
    private readonly _labels = new Map<
        string,
        {label: AppGroupLabel<T>; header: LayoutRectangle}
    >();

    constructor(
        view: AppGroupChromeView<T>,
        transform: (rectangle: LayoutRectangle) => LayoutRectangle
    ) {
        this._view = view;
        this._transform = transform;
    }

    update(groups: readonly ApplicationGroupLayout<T>[]): void {
        const current = new Set<string>();

        for (const group of groups) {
            if (group.header === null) continue;

            current.add(group.key);
            let entry = this._labels.get(group.key);

            if (entry === undefined) {
                entry = {
                    label: this._view.createLabel(group),
                    header: group.header,
                };
                this._labels.set(group.key, entry);
            }

            entry.header = group.header;
            entry.label.update(group);
        }

        for (const [key, entry] of this._labels) {
            if (current.has(key)) continue;

            entry.label.destroy();
            this._labels.delete(key);
        }

        this.syncGeometry();
    }

    syncGeometry(): void {
        for (const {label, header} of this._labels.values())
            label.setRectangle(this._transform(header));
    }

    setState(state: AppGroupChromeState): void {
        if (
            !Number.isFinite(state.overviewProgress) ||
            !Number.isFinite(state.spreadProgress)
        )
            throw new RangeError('Overview progress must be finite');

        const pickerOpacity = Math.max(
            0,
            1 - Math.abs(state.overviewProgress - WINDOW_PICKER_STATE)
        );
        const opacity = state.searchActive
            ? 0
            : Math.min(
                  pickerOpacity,
                  Math.max(0, Math.min(1, state.spreadProgress))
              );
        this._view.setOpacity(Math.round(MAX_OPACITY * opacity));
    }

    destroy(): void {
        for (const {label} of this._labels.values()) label.destroy();

        this._labels.clear();
        this._view.setOpacity(0);
    }
}
