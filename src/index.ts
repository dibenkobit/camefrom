import { intercept } from './intercept';
import { resolve } from './resolve';
import type { Provenance } from './types';

export type { Hop, Provenance, RequestMeta } from './types';

let installed = false;

/**
 * Start recording responses and reads.
 *
 * Called automatically on import. Exported so it can be installed explicitly
 * before other libraries patch `fetch` / `XMLHttpRequest`.
 */
export function install(): void {
    if (installed) return;
    installed = true;
    intercept();
}

/**
 * Answer "where did this come from?" for a node in the page.
 *
 * Returns `null` when the node carries no value we recorded — a static label,
 * for instance. Callers should treat `null` as "no data", never as an error.
 */
export function camefrom(target: Node | null): Provenance | null {
    return resolve(target);
}

declare global {
    interface Window {
        camefrom: typeof camefrom;
    }
}

install();

if (typeof window !== 'undefined') {
    window.camefrom = camefrom;
}
