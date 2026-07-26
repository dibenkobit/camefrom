import { recordRead } from './store';

export interface Origin {
    responseId: number;
    /** Path inside the response body. Empty string for the body itself. */
    path: string;
}

/**
 * Target to proxy. Caching here is not an optimisation: handing out two
 * proxies for one object would break `Object.is`, and React would treat every
 * render as a change.
 */
const proxies = new WeakMap<object, object>();
const origins = new WeakMap<object, Origin>();

/** Only what `JSON.parse` produces. Anything exotic is left alone. */
function isTaintable(value: unknown): value is object {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return true;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function childPath(parent: string, key: string, isIndex: boolean): string {
    if (isIndex) return `${parent}[${key}]`;
    return parent ? `${parent}.${key}` : key;
}

/**
 * Wrap a parsed response body so every primitive read out of it is recorded
 * along with the path it came from.
 */
export function taint<T>(value: T, responseId: number, path = ''): T {
    if (!isTaintable(value)) return value;

    const cached = proxies.get(value);
    if (cached) return cached as T;

    const isArray = Array.isArray(value);

    const proxy = new Proxy(value, {
        get(target, key, receiver) {
            const property: unknown = Reflect.get(target, key, receiver);

            if (typeof key === 'symbol' || typeof property === 'function') return property;
            // `items.length` is not data. Recording it would let the number of
            // rows masquerade as a value rendered from the response.
            if (isArray && key === 'length') return property;

            // Reporting anything but the raw value for a non-configurable,
            // non-writable property violates a proxy invariant and throws.
            const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
            if (descriptor?.configurable === false && descriptor.writable === false) {
                return property;
            }

            const here = childPath(path, key, isArray);
            if (isTaintable(property)) return taint(property, responseId, here);
            if (property !== undefined) recordRead(responseId, here, property);
            return property;
        }
    });

    proxies.set(value, proxy);
    origins.set(proxy, { responseId, path });
    return proxy as T;
}

/** Where a tainted object came from, if we tainted it. */
export function originOf(value: unknown): Origin | undefined {
    if (value === null || typeof value !== 'object') return undefined;
    return origins.get(value);
}
