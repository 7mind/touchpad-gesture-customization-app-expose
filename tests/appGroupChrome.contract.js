function check(condition, message) {
    if (!condition) throw new Error(message);
}

export async function runAppGroupChromeContract(createHarness) {
    for (const appearance of [0, 1])
        await runAppearanceContract(createHarness, appearance);
}

async function runAppearanceContract(createHarness, appearance) {
    const harness = createHarness(appearance);
    const {controller, groups} = harness;
    const picker = {
        overviewProgress: 1,
        spreadProgress: 1,
        searchActive: false,
    };

    try {
        controller.setState(picker);
        controller.update(groups);
        await harness.flush();
        const initial = harness.read();
        check(initial.labels.length === 2, 'each group needs one header');
        check(initial.opacity === 255, 'headers must be visible in the picker');

        for (const label of initial.labels) {
            check(
                !label.reactive && !label.canFocus,
                'headers must not capture input'
            );
            check(
                label.hasIcon && label.hasName === (appearance === 0),
                'header mode needs an icon/name; icon mode must have only an icon'
            );
            check(
                label.height === groups[0].header.height,
                'headers must fit their reserved height'
            );
            check(
                label.iconHeight <= label.height,
                'application icons must fit the reserved header at the current scale'
            );
        }

        controller.update(
            groups.map(group => ({
                ...group,
                header: {...group.header, x: group.header.x + 20},
            }))
        );
        await harness.flush();
        const moved = harness.read();
        check(
            moved.labels.every(
                (label, index) => label.actor === initial.labels[index].actor
            ),
            'relayout must reuse existing header actors'
        );
        check(
            moved.labels.every(
                (label, index) =>
                    Math.abs(label.x - initial.labels[index].x - 20) < 0.01
            ),
            'reused headers must follow new geometry'
        );

        controller.update(
            groups.map(group => ({
                ...group,
                header: {...group.header, width: 10},
            }))
        );
        await harness.flush();
        controller.update(groups);
        await harness.flush();
        check(
            harness
                .read()
                .labels.every(
                    (label, index) =>
                        label.width === initial.labels[index].width
                ),
            'headers must recover their natural width after a narrow allocation'
        );

        for (const [state, expected] of [
            [{...picker, overviewProgress: 0}, 0],
            [{...picker, overviewProgress: 0.5, spreadProgress: 0.5}, 128],
            [{...picker, overviewProgress: 2}, 0],
            [{...picker, searchActive: true}, 0],
            [{...picker, spreadProgress: 0}, 0],
            [picker, 255],
        ]) {
            controller.setState(state);
            check(
                harness.read().opacity === expected,
                'headers must track Overview, spread and search state'
            );
        }

        controller.update([groups[0]]);
        check(
            harness.read().labels.length === 1,
            'departed groups must lose their header'
        );
        controller.update(groups.map(group => ({...group, header: null})));
        check(
            harness.read().labels.length === 0,
            'App Exposé must have no redundant group headers'
        );
        controller.update(groups);
        check(
            harness.read().labels.length === 2,
            'headers must return after App Exposé'
        );
        controller.destroy();
        check(
            harness.read().labels.length === 0,
            'teardown must destroy every header'
        );
        check(harness.read().opacity === 0, 'teardown must hide the overlay');
        controller.destroy();
    } finally {
        harness.destroy();
    }
}
