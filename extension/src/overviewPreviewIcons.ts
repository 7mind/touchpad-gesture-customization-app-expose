export type IconOverviewPreview = {
    _icon: {visible: boolean};
    _updateIconScale(): void;
    connect(signal: string, callback: () => void): number;
    disconnect(id: number): void;
};

export class OverviewPreviewIcons {
    private readonly _prototype: Pick<IconOverviewPreview, '_updateIconScale'>;
    private readonly _previews: () => IconOverviewPreview[];
    private readonly _showInApplicationOverview: boolean;
    private readonly _report: (message: string) => void;
    private readonly _hidden = new Map<
        IconOverviewPreview,
        {visible: boolean; destroyId: number}
    >();
    private readonly _grouped = new WeakSet<IconOverviewPreview>();
    private _appOverviewActive = false;
    private _original: IconOverviewPreview['_updateIconScale'] | null = null;
    private _installed: IconOverviewPreview['_updateIconScale'] | null = null;

    constructor(
        prototype: Pick<IconOverviewPreview, '_updateIconScale'>,
        previews: () => IconOverviewPreview[],
        showInApplicationOverview: boolean,
        report: (message: string) => void
    ) {
        this._prototype = prototype;
        this._previews = previews;
        this._showInApplicationOverview = showInApplicationOverview;
        this._report = report;
    }

    apply(): void {
        const original = this._prototype._updateIconScale;

        if (typeof original !== 'function') {
            this._report(
                'Overview icon visibility is unsupported by this GNOME Shell build'
            );
            return;
        }

        const sync = (preview: IconOverviewPreview) => {
            if (this._installed !== null) this._sync(preview);
        };

        const installed = function (this: IconOverviewPreview) {
            original.call(this);
            sync(this);
        };

        this._original = original;
        this._installed = installed;
        this._prototype._updateIconScale = installed;
    }

    setApplicationOverview(active: boolean): void {
        this._appOverviewActive = active;
        for (const preview of this._previews()) this._sync(preview);
    }

    setGrouped(previews: IconOverviewPreview[], grouped: boolean): void {
        for (const preview of previews) {
            if (grouped) this._grouped.add(preview);
            else this._grouped.delete(preview);
            this._sync(preview);
        }
    }

    private _sync(preview: IconOverviewPreview): void {
        if (this._installed === null) return;
        const hide = this._appOverviewActive
            ? !this._showInApplicationOverview
            : this._grouped.has(preview);

        if (!hide) {
            this._restore(preview);
            return;
        }

        if (!this._hidden.has(preview)) {
            const destroyId = preview.connect('destroy', () =>
                this._hidden.delete(preview)
            );
            this._hidden.set(preview, {
                visible: preview._icon.visible,
                destroyId,
            });
        }

        preview._icon.visible = false;
    }

    private _restore(preview: IconOverviewPreview): void {
        const saved = this._hidden.get(preview);
        if (saved === undefined) return;
        preview.disconnect(saved.destroyId);
        preview._icon.visible = saved.visible;
        this._hidden.delete(preview);
    }

    destroy(): void {
        if (this._installed === null || this._original === null) return;
        if (this._prototype._updateIconScale === this._installed)
            this._prototype._updateIconScale = this._original;
        else
            this._report(
                'Another extension replaced the Overview icon wrapper; its method was left intact'
            );
        this._installed = null;
        this._original = null;
        for (const preview of this._hidden.keys()) this._restore(preview);
    }
}
