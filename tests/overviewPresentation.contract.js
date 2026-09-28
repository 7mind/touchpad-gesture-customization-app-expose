import {setOverviewPreviewStacking} from '../build/src/groupedOverviewStacking.js';

function check(condition, message) {
    if (!condition) throw new Error(message);
}

export async function runOverviewPresentationContract(
    createHarness,
    showAppIcons
) {
    const harness = createHarness(showAppIcons);
    const {previews, icons, presentation} = harness;
    const back = previews[0];
    const originalShow = back.showOverlay;
    const originalRestack = back._restack;
    try {
        icons.apply();
        icons.setGrouped(previews, true);
        presentation.apply(previews);
        presentation.apply(previews);
        setOverviewPreviewStacking(previews);
        const before = harness.order();
        for (const preview of previews) {
            preview.showOverlay(false);
            await harness.flush();
            check(
                harness
                    .order()
                    .every((actor, index) => actor === before[index]),
                'hover must preserve spiral paint order'
            );
            check(
                preview.has_style_class_name('gie-grouped-window-highlight'),
                'hover must highlight the selected preview'
            );
            check(
                preview.window_container.scale_x === 1 &&
                    preview.window_container.scale_y === 1,
                'hover must not grow the preview over its neighbors'
            );
            check(
                previews.every(item => !item._icon.visible),
                'grouped previews must have no individual icons'
            );
            preview.hideOverlay(false);
            check(
                !preview.has_style_class_name('gie-grouped-window-highlight'),
                'leaving must remove highlight'
            );
        }
        icons.setApplicationOverview(true);
        presentation.restore(previews);
        icons.setGrouped(previews, false);
        check(
            previews.every(preview => preview._icon.visible === showAppIcons),
            'App Exposé must honor its independent icon setting'
        );
        check(
            back.showOverlay === originalShow &&
                back._restack === originalRestack,
            'App Exposé must restore stock preview methods'
        );
        back.showOverlay(false);
        check(
            harness.order().at(-1) === back,
            'spread windows must retain stock hover raising'
        );
        back.hideOverlay(false);
        icons.setApplicationOverview(false);
        check(
            previews.every(preview => preview._icon.visible),
            'stock Overview must restore individual icons'
        );
        icons.setGrouped(previews, true);
        presentation.apply(previews);
        presentation.destroy();
        icons.destroy();
        check(
            previews.every(preview => preview._icon.visible),
            'disable must restore individual icons'
        );
        check(
            back.showOverlay === originalShow &&
                back._restack === originalRestack,
            'disable must restore preview methods'
        );
        presentation.destroy();
        icons.destroy();
    } finally {
        presentation.destroy();
        icons.destroy();
        harness.destroy();
    }
}
