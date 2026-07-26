import { recordResponse } from './store';
import { taint } from './taint';
import type { RequestMeta } from './types';

/**
 * A body we have seen as text but not yet as data.
 *
 * axios asks XHR for text and runs `JSON.parse` itself, so the only seam
 * between an XHR response and the object the app ends up holding is the parse
 * call. We keep the text around to recognise it when that happens.
 */
interface Pending {
    text: string;
    meta: RequestMeta;
    responseId?: number;
}

const MAX_PENDING = 20;
const pending: Pending[] = [];

let patched = false;

function remember(text: string, meta: RequestMeta): void {
    pending.push({ text, meta });
    if (pending.length > MAX_PENDING) pending.shift();
}

function findPending(text: string): Pending | undefined {
    for (let index = pending.length - 1; index >= 0; index--) {
        const entry = pending[index];
        // Length first: comparing two 80KB strings that differ is wasteful.
        if (entry && entry.text.length === text.length && entry.text === text) return entry;
    }
    return undefined;
}

function capture(meta: RequestMeta, body: unknown): unknown {
    return taint(body, recordResponse(meta, body).id);
}

const fetchMeta = new WeakMap<Response, RequestMeta>();

function patchFetch(): void {
    if (typeof globalThis.fetch !== 'function' || typeof Response === 'undefined') return;

    const originalFetch = globalThis.fetch;
    const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const startedAt = Date.now();
        const response = await originalFetch(input, init);
        fetchMeta.set(response, {
            method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
            url: response.url || String(input),
            status: response.status,
            startedAt,
            durationMs: Date.now() - startedAt
        });
        return response;
    };
    // Carries over whatever the runtime hung off fetch, such as Bun's
    // `preconnect`, so replacing it stays invisible.
    globalThis.fetch = Object.assign(wrapped, originalFetch);

    const originalJson = Response.prototype.json;
    Response.prototype.json = async function json(this: Response) {
        const body: unknown = await originalJson.call(this);
        const meta = fetchMeta.get(this);
        return meta ? capture(meta, body) : body;
    };

    const originalText = Response.prototype.text;
    Response.prototype.text = async function text(this: Response) {
        const body = await originalText.call(this);
        const meta = fetchMeta.get(this);
        if (meta) remember(body, meta);
        return body;
    };
}

interface XhrMeta {
    method: string;
    url: string;
    startedAt: number;
}

const xhrMeta = new WeakMap<XMLHttpRequest, XhrMeta>();

function patchXhr(): void {
    if (typeof XMLHttpRequest === 'undefined') return;

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function open(
        this: XMLHttpRequest,
        method: string,
        url: string | URL,
        isAsync: boolean = true,
        username?: string | null,
        password?: string | null
    ): void {
        xhrMeta.set(this, { method, url: String(url), startedAt: 0 });
        originalOpen.call(this, method, url, isAsync, username, password);
    };

    XMLHttpRequest.prototype.send = function send(
        this: XMLHttpRequest,
        body?: Document | XMLHttpRequestBodyInit | null
    ): void {
        const meta = xhrMeta.get(this);
        if (meta) {
            meta.startedAt = Date.now();
            this.addEventListener('load', () => {
                // Reading responseText throws for binary response types.
                if (this.responseType !== '' && this.responseType !== 'text') return;
                remember(this.responseText, {
                    method: meta.method,
                    url: meta.url,
                    status: this.status,
                    startedAt: meta.startedAt,
                    durationMs: Date.now() - meta.startedAt
                });
            });
        }
        originalSend.call(this, body);
    };
}

function patchJsonParse(): void {
    const originalParse = JSON.parse;
    JSON.parse = ((text: string, reviver?: Parameters<typeof originalParse>[1]): unknown => {
        const result: unknown = originalParse(text, reviver);
        if (typeof text !== 'string') return result;

        const entry = findPending(text);
        if (!entry) return result;

        // One HTTP response stays one recorded response, however many times
        // the same body gets parsed.
        entry.responseId ??= recordResponse(entry.meta, result).id;
        return taint(result, entry.responseId);
    }) as typeof JSON.parse;
}

/**
 * Start watching HTTP traffic.
 *
 * Every patch calls through to the original and never swallows errors: MSW and
 * Sentry patch the same functions, and we must not care who got there first.
 */
export function intercept(): void {
    if (patched) return;
    patched = true;
    patchFetch();
    patchXhr();
    patchJsonParse();
}
