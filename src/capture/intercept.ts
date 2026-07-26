import type { RequestMeta } from "../shared/types";
import { findResponse, recordResponse } from "./store";
import { taint } from "./taint";

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

/**
 * Marks a function as already ours.
 *
 * A module-level flag would miss the two cases that actually happen: two
 * copies of this package in one dependency tree, and globals such as
 * `XMLHttpRequest` that only exist after the first call.
 */
const PATCHED = Symbol.for("camefrom.patched");

function mark<T extends object>(replacement: T): T {
	Object.defineProperty(replacement, PATCHED, { value: true });
	return replacement;
}

function isPatched(candidate: unknown): boolean {
	return typeof candidate === "function" && PATCHED in candidate;
}

/**
 * Finds a property descriptor anywhere up the prototype chain.
 *
 * Accessors are not always where you expect them: happy-dom, jsdom and various
 * polyfills subclass XMLHttpRequest, leaving `prototype` with nothing but a
 * constructor while the real accessors sit on a parent.
 */
function inheritedDescriptor(
	target: object,
	key: string,
): PropertyDescriptor | undefined {
	let holder: object | null = target;
	while (holder) {
		const descriptor = Object.getOwnPropertyDescriptor(holder, key);
		if (descriptor) return descriptor;
		holder = Object.getPrototypeOf(holder) as object | null;
	}
	return undefined;
}

function remember(text: string, meta: RequestMeta): void {
	pending.push({ text, meta });
	if (pending.length > MAX_PENDING) pending.shift();
}

function findPending(text: string): Pending | undefined {
	for (let index = pending.length - 1; index >= 0; index--) {
		const entry = pending[index];
		// Length first: comparing two 80KB strings that differ is wasteful.
		if (entry && entry.text.length === text.length && entry.text === text)
			return entry;
	}
	return undefined;
}

function capture(meta: RequestMeta, body: unknown): unknown {
	return taint(body, recordResponse(meta, body).id);
}

const fetchMeta = new WeakMap<Response, RequestMeta>();

/**
 * The headers the app set on a `fetch`, lower-cased.
 *
 * Both places one can come from, in the precedence `fetch` itself applies: a
 * `Request` passed as the input carries its own, and `init` replaces them name
 * by name. Nothing here may throw — an invalid header name is the app's problem
 * to report, from its own call, and not something to fail a request over.
 */
function headersOf(
	input: RequestInfo | URL,
	init?: RequestInit,
): Record<string, string> | undefined {
	if (typeof Headers === "undefined") return undefined;

	try {
		const given =
			typeof Request !== "undefined" && input instanceof Request
				? new Headers(input.headers)
				: new Headers();
		if (init?.headers) {
			new Headers(init.headers).forEach((value, name) => {
				given.set(name, value);
			});
		}

		const headers: Record<string, string> = {};
		given.forEach((value, name) => {
			headers[name] = value;
		});
		return Object.keys(headers).length > 0 ? headers : undefined;
	} catch {
		return undefined;
	}
}

function patchFetch(): void {
	if (typeof globalThis.fetch !== "function" || typeof Response === "undefined")
		return;
	if (isPatched(globalThis.fetch)) return;

	const originalFetch = globalThis.fetch;
	const wrapped = async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const startedAt = Date.now();
		const response = await originalFetch(input, init);
		fetchMeta.set(response, {
			method: init?.method ?? (input instanceof Request ? input.method : "GET"),
			url: response.url || String(input),
			status: response.status,
			startedAt,
			durationMs: Date.now() - startedAt,
			headers: headersOf(input, init),
		});
		return response;
	};
	// Carries over whatever the runtime hung off fetch, such as Bun's
	// `preconnect`, so replacing it stays invisible.
	globalThis.fetch = mark(Object.assign(wrapped, originalFetch));

	const originalJson = Response.prototype.json;
	Response.prototype.json = mark(async function json(this: Response) {
		const body: unknown = await originalJson.call(this);
		const meta = fetchMeta.get(this);
		return meta ? capture(meta, body) : body;
	});

	const originalText = Response.prototype.text;
	Response.prototype.text = mark(async function text(this: Response) {
		const body = await originalText.call(this);
		const meta = fetchMeta.get(this);
		if (meta) remember(body, meta);
		return body;
	});
}

interface XhrMeta {
	method: string;
	url: string;
	startedAt: number;
	/** Whatever the app set through `setRequestHeader`, lower-cased. */
	headers?: Record<string, string>;
	/** responseText can be read many times; the body is only recorded once. */
	remembered?: boolean;
}

const xhrMeta = new WeakMap<XMLHttpRequest, XhrMeta>();

function patchXhr(): void {
	if (typeof XMLHttpRequest === "undefined") return;
	if (isPatched(XMLHttpRequest.prototype.open)) return;

	const originalOpen = XMLHttpRequest.prototype.open;
	const originalSend = XMLHttpRequest.prototype.send;

	XMLHttpRequest.prototype.open = mark(function open(
		this: XMLHttpRequest,
		method: string,
		url: string | URL,
		isAsync: boolean = true,
		username?: string | null,
		password?: string | null,
	): void {
		xhrMeta.set(this, { method, url: String(url), startedAt: 0 });
		originalOpen.call(this, method, url, isAsync, username, password);
	});

	// The only seam a header passes through, and the reason a `curl` copied out
	// of the panel carries the app's `Authorization` rather than none: XHR keeps
	// what it was given to itself and offers nothing to read it back with.
	const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
	XMLHttpRequest.prototype.setRequestHeader = mark(function setRequestHeader(
		this: XMLHttpRequest,
		name: string,
		value: string,
	): void {
		const meta = xhrMeta.get(this);
		if (meta) {
			meta.headers ??= {};
			const headers = meta.headers;
			const key = String(name).toLowerCase();
			// Set twice is one header holding both values, which is what the wire
			// carries and so what reproduces the call.
			const already = headers[key];
			headers[key] = already === undefined ? value : `${already}, ${value}`;
		}
		originalSetHeader.call(this, name, value);
	});

	XMLHttpRequest.prototype.send = mark(function send(
		this: XMLHttpRequest,
		body?: Document | XMLHttpRequestBodyInit | null,
	): void {
		const meta = xhrMeta.get(this);
		if (meta) meta.startedAt = Date.now();
		originalSend.call(this, body);
	});

	// Hooking the getter rather than the load event is deliberate. axios reads
	// responseText from onreadystatechange, which fires before any load
	// listener we could add, so an event-based hook is always too late and the
	// body would be parsed before we ever saw it.
	const descriptor = inheritedDescriptor(
		XMLHttpRequest.prototype,
		"responseText",
	);
	const readOriginal = descriptor?.get;
	if (!descriptor || !readOriginal) return;

	// Defined on the class we were handed, shadowing the inherited accessor
	// rather than mutating a prototype we do not own.
	Object.defineProperty(XMLHttpRequest.prototype, "responseText", {
		...descriptor,
		get: mark(function responseText(this: XMLHttpRequest): string {
			const text = readOriginal.call(this) as string;
			const meta = xhrMeta.get(this);

			if (
				meta &&
				!meta.remembered &&
				this.readyState === XMLHttpRequest.DONE &&
				text !== ""
			) {
				meta.remembered = true;
				remember(text, {
					method: meta.method,
					url: meta.url,
					status: this.status,
					startedAt: meta.startedAt,
					durationMs: Date.now() - meta.startedAt,
					headers: meta.headers,
				});
			}

			return text;
		}),
	});
}

function patchJsonParse(): void {
	if (isPatched(JSON.parse)) return;

	const originalParse = JSON.parse;
	JSON.parse = mark(
		(text: string, reviver?: Parameters<typeof originalParse>[1]): unknown => {
			const result: unknown = originalParse(text, reviver);
			if (typeof text !== "string") return result;

			const entry = findPending(text);
			if (!entry) return result;

			// One HTTP response stays one recorded response, however many times
			// the same body gets parsed — unless it has since aged out of the
			// store, in which case pointing at it would trace to nothing.
			if (entry.responseId === undefined || !findResponse(entry.responseId)) {
				entry.responseId = recordResponse(entry.meta, result).id;
			}
			return taint(result, entry.responseId);
		},
	) as typeof JSON.parse;
}

/**
 * Start watching HTTP traffic. Safe to call more than once: each patch skips
 * what it already replaced, and picks up anything that appeared since.
 *
 * Every patch calls through to the original and never swallows errors: MSW and
 * Sentry patch the same functions, and we must not care who got there first.
 */
export function intercept(): void {
	patchFetch();
	patchXhr();
	patchJsonParse();
}
