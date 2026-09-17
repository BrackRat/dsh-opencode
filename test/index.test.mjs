import assert from 'node:assert/strict';
import { test } from 'node:test';

import { apply, hasHeader, injectSessionHeaders, isOpencodeModel } from '../lib/index.js';

/** Minimal fake of the pi-ai Models prototype the adapter exposes. */
class FakeModels {
	stream(model, context, options) {
		return { entry: 'stream', model, context, options };
	}
	streamSimple(model, context, options) {
		return { entry: 'streamSimple', model, context, options };
	}
}

/**
 * Build a plugin context whose adapter hands out one fake Models instance.
 * @returns the captured `llm/stream` middleware and the models instance it patched.
 */
function fakeContext() {
	const models = new FakeModels();
	const adapter = { current: () => ({ models }) };
	let middleware;
	const ctx = {
		logger: { debug() {}, warn() {} },
		llm: { adapters: new Map([['opencode-go', { adapter }]]) },
		on(event, listener) {
			assert.equal(event, 'llm/stream');
			middleware = listener;
		},
	};
	apply(ctx);
	return { models, middleware };
}

test('isOpencodeModel matches the routes and hosts the gateway serves', () => {
	assert.equal(isOpencodeModel({ provider: 'opencode-go' }), true);
	assert.equal(isOpencodeModel({ provider: 'opencode' }), true);
	assert.equal(isOpencodeModel({ provider: 'deepseek', baseUrl: 'https://opencode.ai/zen/go/v1' }), true);
	assert.equal(isOpencodeModel({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' }), false);
	assert.equal(isOpencodeModel({ provider: 'deepseek', baseUrl: 'not a url' }), false);
	assert.equal(isOpencodeModel(undefined), false);
	assert.equal(isOpencodeModel(null), false);
});

test('hasHeader is case-insensitive', () => {
	assert.equal(hasHeader({ 'X-Opencode-Session': 'x' }, 'x-opencode-session'), true);
	assert.equal(hasHeader({ 'x-opencode-client': 'dsh' }, 'x-opencode-session'), false);
	assert.equal(hasHeader(undefined, 'x-opencode-session'), false);
});

test('injectSessionHeaders adds both headers without mutating the input', () => {
	const options = { sessionId: 'sess-1', headers: { 'x-custom': 'kept' } };
	const next = injectSessionHeaders({ provider: 'opencode-go' }, options);
	assert.deepEqual(next.headers, {
		'x-opencode-session': 'sess-1',
		'x-opencode-client': 'dsh',
		'x-custom': 'kept',
	});
	assert.equal(options.headers['x-opencode-session'], undefined, 'input options are not mutated');
});

test('injectSessionHeaders skips requests without a session id', () => {
	const missing = { headers: {} };
	assert.equal(injectSessionHeaders({ provider: 'opencode-go' }, missing), missing);
	const empty = { sessionId: '' };
	assert.equal(injectSessionHeaders({ provider: 'opencode-go' }, empty), empty);
});

test('injectSessionHeaders leaves other routes untouched', () => {
	const options = { sessionId: 'sess-1', headers: {} };
	assert.equal(injectSessionHeaders({ provider: 'deepseek' }, options), options);
});

test('injectSessionHeaders defers to explicitly configured headers', () => {
	const fromOptions = { sessionId: 'sess-1', headers: { 'x-opencode-session': 'configured' } };
	assert.equal(injectSessionHeaders({ provider: 'opencode-go' }, fromOptions), fromOptions);

	const model = { provider: 'opencode-go', headers: { 'X-Opencode-Session': 'configured' } };
	const requestOptions = { sessionId: 'sess-1' };
	assert.equal(injectSessionHeaders(model, requestOptions), requestOptions);
});

test('apply wraps the live models prototype and injects per request', () => {
	const { models, middleware } = fakeContext();
	assert.equal(typeof middleware, 'function');

	const marker = middleware({ provider: 'opencode-go', sessionId: 'sess-7' }, () => 'downstream');
	assert.equal(marker, 'downstream', 'the waterfall continues');

	const simple = models.streamSimple({ provider: 'opencode-go' }, { messages: [] }, { sessionId: 'sess-7' });
	assert.equal(simple.options.headers['x-opencode-session'], 'sess-7');
	assert.equal(simple.options.headers['x-opencode-client'], 'dsh');

	const full = models.stream({ provider: 'opencode-go' }, { messages: [] }, { sessionId: 'sess-8' });
	assert.equal(full.options.headers['x-opencode-session'], 'sess-8');
});

test('apply is idempotent across repeated requests', () => {
	const { models, middleware } = fakeContext();
	middleware({ provider: 'opencode-go', sessionId: 'a' }, () => undefined);
	middleware({ provider: 'opencode-go', sessionId: 'b' }, () => undefined);
	const result = models.streamSimple({ provider: 'opencode-go' }, {}, { sessionId: 'c' });
	assert.equal(result.options.headers['x-opencode-session'], 'c');
});

test('apply survives an adapter shape it does not understand', () => {
	const middlewares = [];
	const ctx = {
		logger: { debug() {}, warn() {} },
		llm: { adapters: new Map([['opencode-go', {}]]) },
		on(event, listener) {
			middlewares.push(listener);
		},
	};
	apply(ctx);
	const options = { provider: 'opencode-go', sessionId: 'sess-1' };
	let nextCalled = false;
	const result = middlewares[0](options, () => {
		nextCalled = true;
		return 'downstream';
	});
	assert.equal(nextCalled, true);
	assert.equal(result, 'downstream');
});
