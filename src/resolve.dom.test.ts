import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { resolve, textOf } from './resolve';
import { recordResponse, reset } from './store';
import { taint } from './taint';

const window = new Window({ url: 'http://localhost' });
// happy-dom nodes are structurally what resolve() needs; it only ever touches
// instance members, never a DOM global.
const document = window.document as unknown as Document;

const meta = { method: 'GET', url: '/api/works', status: 200, startedAt: 0, durationMs: 12 };

afterAll(async () => {
    await window.happyDOM.close();
});

beforeEach(() => {
    reset();
    document.body.innerHTML = '';
});

function seed(body: Record<string, unknown>): void {
    const recorded = recordResponse(meta, body);
    // Reading through the proxy is what registers the paths.
    JSON.stringify(taint(body, recorded.id));
}

/**
 * Cells are written as divs on purpose: a bare `<td>` outside a table is
 * dropped by the parser, in happy-dom and in a real browser alike.
 */
function render(html: string): Element {
    document.body.innerHTML = html;
    const element = document.body.firstElementChild;
    if (!element) throw new Error('nothing rendered');
    return element;
}

function attachFiber(element: Element, fiber: object): Element {
    (element as unknown as Record<string, unknown>)['__reactFiber$test'] = fiber;
    return element;
}

describe('textOf', () => {
    test('takes only the text a node shows itself', () => {
        expect(textOf(render('<div>Барыс<span>ещё что-то</span></div>'))).toBe('Барыс');
    });

    test('falls back to nested text when a node has none of its own', () => {
        expect(textOf(render('<div><span>Барыс</span></div>'))).toBe('Барыс');
    });

    test('a text node yields its own data', () => {
        const cell = render('<div>Барыс</div>');
        expect(textOf(cell.firstChild as Node)).toBe('Барыс');
    });
});

describe('resolve', () => {
    test('traces a cell back to the field it was rendered from', () => {
        seed({ items: [{ contractor: { name: 'ТОО Барыс' } }] });

        const found = resolve(render('<div>ТОО Барыс</div>'));
        expect(found?.broken).toBe(false);
        expect(found?.path).toBe('items[0].contractor.name');
        expect(found?.request?.url).toBe('/api/works');
    });

    test('works from the text node a click actually lands on', () => {
        seed({ name: 'Барыс' });

        const cell = render('<div>Барыс</div>');
        expect(resolve(cell.firstChild)?.path).toBe('name');
    });

    test('returns nothing for an empty target', () => {
        expect(resolve(null)).toBeNull();
        expect(resolve(render('<div>   </div>'))).toBeNull();
    });
});

describe('the component hop', () => {
    test('names the component that rendered the text', () => {
        seed({ name: 'Барыс' });

        const cell = attachFiber(render('<div>Барыс</div>'), {
            // React hangs fibers off host elements, so the component sits up
            // the return chain rather than on the node itself.
            type: 'div',
            return: { type: function WorkRow() {}, return: null }
        });

        expect(resolve(cell)?.hops.at(-1)).toMatchObject({ kind: 'component', label: '<WorkRow>' });
    });

    test('uses displayName for wrappers such as memo', () => {
        const cell = attachFiber(render('<div>Барыс</div>'), {
            type: { displayName: 'MemoWorkRow' },
            return: null
        });

        expect(resolve(cell)?.hops.at(-1)).toMatchObject({ label: '<MemoWorkRow>' });
    });

    test('is still reported when the text is a static label', () => {
        const label = attachFiber(render('<label>Подрядчик</label>'), {
            type: function WorkForm() {},
            return: null
        });

        const found = resolve(label);
        expect(found?.broken).toBe(true);
        expect(found?.hops).toHaveLength(1);
        expect(found?.hops.at(-1)).toMatchObject({ kind: 'component', label: '<WorkForm>' });
    });
});

describe('source attributes', () => {
    test('are read from whichever inspector left them', () => {
        const cell = render('<div data-tsd-source="src/works.table-columns.tsx:41:9">Барыс</div>');

        expect(resolve(cell)?.hops.at(-1)).toMatchObject({
            file: 'src/works.table-columns.tsx',
            line: 41,
            column: 9
        });
    });

    test('ours wins when both are present', () => {
        const cell = render(
            '<div data-camefrom-source="ours.tsx:1:1" data-tsd-source="theirs.tsx:2:2">Барыс</div>'
        );

        expect(resolve(cell)?.hops.at(-1)).toMatchObject({ file: 'ours.tsx', line: 1 });
    });

    test('are found on an ancestor, not just the node itself', () => {
        render('<div data-tsd-source="src/works.row.tsx:10:2"><span>Барыс</span></div>');
        const cell = document.querySelector('span');

        expect(resolve(cell)?.hops.at(-1)).toMatchObject({ file: 'src/works.row.tsx', line: 10 });
    });

    test('degrade to a bare file when there is no position', () => {
        const cell = render('<div data-tsd-source="src/works.tsx">Барыс</div>');

        expect(resolve(cell)?.hops.at(-1)).toMatchObject({ file: 'src/works.tsx', line: undefined });
    });
});
