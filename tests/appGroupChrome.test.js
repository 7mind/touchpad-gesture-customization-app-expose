import {AppGroupChromeController} from '../build/src/appGroupChromeController.js';
import {runAppGroupChromeContract} from './appGroupChrome.contract.js';

await runAppGroupChromeContract(appearance => {
    const labels = new Map();
    let opacity = 0;
    const groups = ['Editor', 'Browser'].map((name, index) => ({
        key: name,
        items: [{name, icon: `${name}.png`}],
        region: {x: index * 600, y: 0, width: 600, height: 500},
        header: {
            x: index * 600,
            y: 0,
            width: 600,
            height: appearance === 0 ? 36 : 64,
        },
        weight: 1,
    }));
    const controller = new AppGroupChromeController(
        {
            createLabel(group) {
                const actor = {};
                const record = {
                    actor,
                    x: 0,
                    width: 0,
                    height: 0,
                    iconHeight: appearance === 0 ? 24 : 64,
                    reactive: false,
                    canFocus: false,
                    hasIcon: false,
                    hasName: false,
                };
                labels.set(group.key, record);

                return {
                    update(current) {
                        record.hasIcon = current.items[0].icon.length > 0;
                        record.hasName =
                            appearance === 0 &&
                            current.items[0].name.length > 0;
                    },
                    setRectangle(rectangle) {
                        record.x = rectangle.x;
                        record.width = rectangle.width;
                        record.height = rectangle.height;
                    },
                    destroy() {
                        labels.delete(group.key);
                    },
                };
            },
            setOpacity(value) {
                opacity = value;
            },
        },
        rectangle => rectangle
    );

    return {
        controller,
        groups,
        flush: async () => {},
        read: () => ({
            opacity,
            labels: Array.from(labels.values()).map(label => ({...label})),
        }),
        destroy: () => controller.destroy(),
    };
});

console.log('application group chrome contract passed with the in-memory view');
