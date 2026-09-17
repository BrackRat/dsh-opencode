/**
 * dsh-opencode-session — send the `x-opencode-session` header opencode.ai's
 * gateway requires on `opencode` / `opencode-go` routes.
 *
 * The Console Go gateway rejects a request without that header with
 * `400 MissingSessionID`: the header names the conversation so the gateway can
 * route the request to the node holding that conversation's cache. The pi
 * coding agent sends it from its provider-attribution layer, but the shared
 * library dsh uses for these routes (`@earendil-works/pi-ai`) does not
 * implement it yet, so every opencode / opencode-go model call started from
 * dsh fails.
 *
 * This plugin restores parity without touching installed files. It installs an
 * in-memory wrapper on the live pi-ai `Models` prototype — obtained from the
 * adapter the request is about to use, so it is guaranteed to be the exact
 * module instance in play — and injects the header from the caller's session
 * id before the adapter dispatches. pi-ai merges `options.headers` last in
 * every wire protocol, so an explicitly configured header still wins. The
 * wrapper re-installs itself on every boot, so dsh upgrades need no action,
 * and it never throws into a request: a plugin that cannot observe a future
 * build logs a warning and steps aside.
 *
 * Scope: providers `opencode` and `opencode-go`, plus any model whose base URL
 * is hosted on `opencode.ai` — the same predicate the pi coding agent uses.
 *
 * @module dsh-opencode-session
 */

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'opencode-session-header';

/** The llm service owns the adapter registry this plugin reads. */
export const inject = ['llm'];

/** Host whose gateway requires the session header. */
const OPENCODE_HOST = 'opencode.ai';

/** Provider routes that always target the opencode gateway. */
const OPENCODE_PROVIDERS = new Set(['opencode', 'opencode-go']);

/** Header the gateway routes on. */
const SESSION_HEADER = 'x-opencode-session';

/** Client-identification header the pi coding agent sends alongside. */
const CLIENT_HEADER = 'x-opencode-client';

/** Value sent for {@link CLIENT_HEADER}; mirrors pi's `pi` value. */
const CLIENT_VALUE = 'dsh';

/** Prototypes already wrapped, so re-entry through the middleware is a no-op. */
const patchedPrototypes = new WeakSet();

/**
 * Whether one pi-ai model targets the opencode gateway.
 * @param model - the pi-ai model descriptor driving the request.
 * @returns true when the session header applies to this request.
 */
export function isOpencodeModel(model) {
	if (model === null || typeof model !== 'object') return false;
	if (OPENCODE_PROVIDERS.has(model.provider)) return true;
	if (typeof model.baseUrl !== 'string') return false;
	try {
		return new URL(model.baseUrl).hostname === OPENCODE_HOST;
	} catch {
		return false;
	}
}

/**
 * Case-insensitive presence check for one header name, because fetch field
 * names are case-insensitive and a configured `X-Opencode-Session` must still
 * suppress the injected copy.
 * @param headers - the header record being inspected, when present.
 * @param wanted - the lowercase header name to look for.
 * @returns true when the record already names the header.
 */
export function hasHeader(headers, wanted) {
	if (headers === null || typeof headers !== 'object') return false;
	return Object.keys(headers).some((key) => key.toLowerCase() === wanted);
}

/**
 * Return the request options with the session headers injected, or the input
 * unchanged when the route, the session id, or an explicit header makes the
 * injection unnecessary. Explicit configuration always wins: a header already
 * present on the request options or on the model descriptor suppresses the
 * injected copy, and the injected names sort below the caller's own headers.
 * @param model - the pi-ai model descriptor driving the request.
 * @param options - the pi-ai request options carrying the session id.
 * @returns options for the underlying pi-ai call.
 */
export function injectSessionHeaders(model, options) {
	const sessionId = options?.sessionId;
	if (sessionId === undefined || sessionId === null || String(sessionId).length === 0) return options;
	if (!isOpencodeModel(model)) return options;
	const headers = options?.headers;
	if (hasHeader(headers, SESSION_HEADER) || hasHeader(model?.headers, SESSION_HEADER)) return options;
	return {
		...options,
		headers: {
			[SESSION_HEADER]: String(sessionId),
			...(hasHeader(headers, CLIENT_HEADER) ? {} : { [CLIENT_HEADER]: CLIENT_VALUE }),
			...headers,
		},
	};
}

/**
 * Wrap the pi-ai `stream` entry points on one prototype. Both names are
 * patched because callers reach them independently (`streamSimple` for the
 * dsh adapter path, `stream` for full control), and instance state stays with
 * the original methods through `this`.
 * @param prototype - the pi-ai Models prototype in use by the live adapter.
 * @param ctx - plugin context, for one install-time debug line.
 */
function patchPrototype(prototype, ctx) {
	if (patchedPrototypes.has(prototype)) return;
	const wrap = (method) =>
		function (model, context, options) {
			return method.call(this, model, context, injectSessionHeaders(model, options));
		};
	let wrapped = 0;
	for (const entryPoint of ['stream', 'streamSimple']) {
		if (typeof prototype[entryPoint] !== 'function') continue;
		prototype[entryPoint] = wrap(prototype[entryPoint]);
		wrapped += 1;
	}
	if (wrapped === 0) return;
	patchedPrototypes.add(prototype);
	ctx.logger.debug('%s: installed the opencode session header on the pi-ai models prototype', name);
}

/**
 * Install the injection on the exact pi-ai module instance the request's
 * adapter uses, then continue the waterfall. The registry lookup, the lazily
 * memoized adapter snapshot, and the patch are all best-effort: a plugin that
 * cannot observe this build must never fail the model request it rides on.
 * @param ctx - plugin context that owns the llm middleware.
 */
export function apply(ctx) {
	ctx.on('llm/stream', (options, next) => {
		try {
			const adapter = ctx.llm?.adapters?.get?.(options?.provider)?.adapter;
			const models = adapter?.current?.()?.models;
			if (models !== undefined && models !== null) patchPrototype(Object.getPrototypeOf(models), ctx);
		} catch (error) {
			ctx.logger.warn('%s: could not install the opencode session header: %s', name, error?.message ?? error);
		}
		return next();
	});
}
