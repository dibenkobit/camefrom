import { findReads, findResponse } from './store';
import type { Hop, Provenance } from './types';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Attributes written by source inspectors. Ours first, then TanStack's. */
const SOURCE_ATTRIBUTES = ['data-camefrom-source', 'data-tsd-source'];

interface Source {
    file: string;
    line?: number;
    column?: number;
}

/** The little of a React fiber we need. */
interface Fiber {
    return: Fiber | null;
    type?: unknown;
    elementType?: unknown;
}

/** The text a node shows itself, without sweeping up everything below it. */
export function textOf(node: Node): string {
    if (node.nodeType === TEXT_NODE) return (node as Text).data;
    if (node.nodeType !== ELEMENT_NODE) return '';

    let direct = '';
    for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === TEXT_NODE) direct += (child as Text).data;
    }
    return direct.trim() === '' ? (node.textContent ?? '') : direct;
}

/**
 * What the text on screen might have been before it was rendered. A cell
 * showing `42` was a number in the response, not the string it is now.
 */
function* candidates(text: string): Generator<unknown> {
    const trimmed = text.trim();
    yield trimmed;
    if (trimmed !== text) yield text;
    if (trimmed !== '') {
        const asNumber = Number(trimmed);
        if (Number.isFinite(asNumber)) yield asNumber;
    }
}

/**
 * The data half of the answer: which response field holds this text.
 *
 * Pure on purpose — the join is the part that can be wrong, and it should be
 * exercisable without a browser.
 */
export function traceText(text: string): Provenance {
    for (const candidate of candidates(text)) {
        // Several fields can hold the same text. The first is reported until
        // there is a panel that can offer the alternatives.
        const read = findReads(candidate)[0];
        if (!read) continue;

        const response = findResponse(read.responseId);
        const hops: Hop[] = [{ kind: 'read', label: read.path }];
        if (response) hops.push({ kind: 'response', label: `${response.method} ${response.url}` });

        return {
            value: candidate,
            path: read.path,
            request: response,
            response: response?.body,
            hops,
            broken: false
        };
    }

    // Nothing matched. Say so rather than offer the nearest guess.
    return { value: text, hops: [], broken: true };
}

function elementOf(node: Node): Element | null {
    return node.nodeType === ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function fiberOf(element: Element): Fiber | undefined {
    for (const key of Object.keys(element)) {
        if (key.startsWith('__reactFiber$')) {
            return (element as unknown as Record<string, Fiber>)[key];
        }
    }
    return undefined;
}

function nearestFiber(node: Node): Fiber | undefined {
    let element = elementOf(node);
    while (element) {
        const fiber = fiberOf(element);
        if (fiber) return fiber;
        element = element.parentElement;
    }
    return undefined;
}

function componentName(fiber: Fiber | undefined): string | undefined {
    let current = fiber;
    while (current) {
        const type = current.type ?? current.elementType;
        if (typeof type === 'function' || (typeof type === 'object' && type !== null)) {
            const named = type as { displayName?: string; name?: string };
            const name = named.displayName ?? named.name;
            if (name) return name;
        }
        current = current.return ?? undefined;
    }
    return undefined;
}

function sourceOf(node: Node): Source | undefined {
    const element = elementOf(node);
    if (!element) return undefined;

    for (const attribute of SOURCE_ATTRIBUTES) {
        const raw = element.closest(`[${attribute}]`)?.getAttribute(attribute);
        if (!raw) continue;
        const match = /^(.+):(\d+):(\d+)$/.exec(raw);
        if (match?.[1]) return { file: match[1], line: Number(match[2]), column: Number(match[3]) };
        return { file: raw };
    }
    return undefined;
}

/** Answer for a node in the page: the field it came from and who rendered it. */
export function resolve(target: Node | null): Provenance | null {
    if (!target) return null;

    const text = textOf(target);
    if (text.trim() === '') return null;

    const provenance = traceText(text);
    const name = componentName(nearestFiber(target));
    const source = sourceOf(target);

    if (name || source) {
        provenance.hops.push({
            kind: 'component',
            label: name ? `<${name}>` : (source?.file ?? ''),
            file: source?.file,
            line: source?.line,
            column: source?.column
        });
    }

    return provenance;
}
