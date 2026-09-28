import {GroupedOverviewPresentation} from '../build/src/groupedOverviewPresentation.js';
import {OverviewPreviewIcons} from '../build/src/overviewPreviewIcons.js';
import {runOverviewPresentationContract} from './overviewPresentation.contract.js';

function createHarness(showAppIcons) {
    const children = [];
    const parent = {get_parent: () => null};
    const prototype = {
        _updateIconScale() {},
        _restack() {
            children.splice(children.indexOf(this), 1);
            if (this._overlayShown) children.push(this);
            else
                children.splice(
                    this._stackAbove === null
                        ? 0
                        : children.indexOf(this._stackAbove) + 1,
                    0,
                    this
                );
        },
        showOverlay() {
            this._overlayShown = true;
            this._restack();
            this.window_container.scale_x = 1.1;
            this.window_container.scale_y = 1.1;
        },
        hideOverlay() {
            this._overlayShown = false;
            this._restack();
            this.window_container.scale_x = 1;
            this.window_container.scale_y = 1;
        },
        setStackAbove(preview) {
            this._stackAbove = preview;
            this._restack();
        },
    };
    const previews = Array.from({length: 3}, () => {
        const classes = new Set();
        const signals = new Map();
        let nextId = 0;
        const preview = Object.assign(Object.create(prototype), {
            inDrag: false,
            _overlayShown: false,
            _stackAbove: null,
            _icon: {visible: true},
            get_parent: () => parent,
            connect: (signal, callback) => {
                signals.set(++nextId, {signal, callback});
                return nextId;
            },
            disconnect: id => signals.delete(id),
            add_style_class_name: name => classes.add(name),
            remove_style_class_name: name => classes.delete(name),
            has_style_class_name: name => classes.has(name),
            window_container: {
                scale_x: 1,
                scale_y: 1,
                remove_transition() {},
            },
        });
        children.push(preview);
        return preview;
    });
    const report = message => {
        throw new Error(message);
    };
    return {
        previews,
        icons: new OverviewPreviewIcons(
            prototype,
            () => previews,
            showAppIcons,
            report
        ),
        presentation: new GroupedOverviewPresentation(report),
        order: () => [...children],
        flush: async () => {},
        destroy() {},
    };
}

for (const showAppIcons of [false, true])
    await runOverviewPresentationContract(createHarness, showAppIcons);

console.log('Overview presentation contract passed with in-memory previews');
