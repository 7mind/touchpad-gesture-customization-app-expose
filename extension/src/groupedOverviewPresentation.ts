type PreviewSurface = {
    scale_x: number;
    scale_y: number;
    remove_transition(name: string): void;
};

export type PresentedOverviewPreview = {
    add_style_class_name(name: string): void;
    remove_style_class_name(name: string): void;
    inDrag: boolean;
    _overlayShown: boolean;
    window_container: PreviewSurface;
    showOverlay(animate: boolean): void;
    _restack(): void;
    connect(signal: string, callback: () => void): number;
    disconnect(id: number): void;
};

const HIGHLIGHT_CLASS = 'gie-grouped-window-highlight';

export class GroupedOverviewPresentation {
    private readonly _restore = new Map<PresentedOverviewPreview, () => void>();
    private readonly _report: (message: string) => void;

    constructor(report: (message: string) => void) {
        this._report = report;
    }

    apply(previews: PresentedOverviewPreview[]): void {
        for (const preview of previews) {
            if (this._restore.has(preview)) continue;

            const originalRestack = preview._restack;
            const originalShow = preview.showOverlay;
            let active = true;

            const highlight = () => {
                if (preview._overlayShown && !preview.inDrag)
                    preview.add_style_class_name(HIGHLIGHT_CLASS);
                else preview.remove_style_class_name(HIGHLIGHT_CLASS);
            };

            const resetScale = () => {
                preview.window_container.remove_transition('scale-x');
                preview.window_container.remove_transition('scale-y');
                preview.window_container.scale_x = 1;
                preview.window_container.scale_y = 1;
            };

            const restack = function (this: PresentedOverviewPreview) {
                if (!active || this.inDrag) return originalRestack.call(this);
                const shown = this._overlayShown;
                this._overlayShown = false;

                try {
                    originalRestack.call(this);
                } finally {
                    this._overlayShown = shown;
                }

                highlight();
            };

            const show = function (
                this: PresentedOverviewPreview,
                animate: boolean
            ) {
                originalShow.call(this, animate);

                if (active && !this.inDrag) {
                    resetScale();
                    highlight();
                }
            };

            preview._restack = restack;
            preview.showOverlay = show;
            resetScale();
            highlight();
            const destroyId = preview.connect('destroy', () => {
                active = false;
                this._restore.delete(preview);
            });
            this._restore.set(preview, () => {
                active = false;
                preview.disconnect(destroyId);
                if (preview._restack === restack)
                    preview._restack = originalRestack;
                else
                    this._report(
                        'Another extension replaced the grouped preview restack wrapper; its method was left intact'
                    );
                if (preview.showOverlay === show)
                    preview.showOverlay = originalShow;
                else
                    this._report(
                        'Another extension replaced the grouped preview overlay wrapper; its method was left intact'
                    );
                preview.remove_style_class_name(HIGHLIGHT_CLASS);
            });
        }
    }

    restore(previews: PresentedOverviewPreview[]): void {
        for (const preview of previews) {
            const restore = this._restore.get(preview);
            if (restore === undefined) continue;
            restore();
            this._restore.delete(preview);
        }
    }

    destroy(): void {
        this.restore([...this._restore.keys()]);
    }
}
