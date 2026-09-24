export type OverviewPreviewActor = {
    get_parent(): OverviewPreviewActor | null;
};

export type StackableOverviewPreview = OverviewPreviewActor & {
    inDrag: boolean;
    _overlayShown: boolean;
    setStackAbove(preview: StackableOverviewPreview | null): void;
    _restack(): void;
};

export function setOverviewPreviewStacking(
    previews: StackableOverviewPreview[]
): void {
    const siblings = new Map<
        OverviewPreviewActor,
        StackableOverviewPreview[]
    >();
    let previous: StackableOverviewPreview | null = null;

    for (const preview of previews) {
        if (preview.inDrag) {
            preview.setStackAbove(previous);
            continue;
        }

        const parent = preview.get_parent();
        if (parent === null) continue;
        previous = preview;

        const group = siblings.get(parent);
        if (group === undefined) siblings.set(parent, [preview]);
        else group.push(preview);
    }

    for (const group of siblings.values()) {
        let previous: StackableOverviewPreview | null = null;

        for (const preview of group) {
            preview.setStackAbove(previous);
            previous = preview;
        }

        for (const preview of group)
            if (preview._overlayShown) preview._restack();
    }
}
