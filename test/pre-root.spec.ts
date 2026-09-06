/**
 * Thunderstruck pre-root store + boundary helper tests — framework-free.
 *
 * Correlation is by OBJECT IDENTITY through a WeakMap: concurrent requests
 * can never read each other's payloads because each holds only its own
 * objects. Retention IS the request objects' lifetime — there is no
 * release step by design.
 */
import { describe, it, expect } from 'vitest';
import {
	feedPreRoot,
	feedValidatedPreRoot,
	getPreRoot,
} from '../src/thunderstruck/pre-root.js';
import { feedPreRootFromRequest } from '../src/thunderstruck/feed-from-request.js';

describe('pre-root store', () => {
	it('correlates every stamped request part to the same payload', () => {
		const body = { hello: 'world' };
		const query = { page: '2' };
		const headers = { traceparent: '00-abc-def-01', 'x-request-id': 'req-1' };
		feedPreRoot({ method: 'POST', url: '/x', params: { id: '1' }, query, body, headers });

		const viaBody = getPreRoot(body);
		expect(viaBody?.raw).toEqual({
			method  : 'POST',
			url     : '/x',
			params  : { id: '1' },
			query,
			body,
			headers,
		});
		expect(getPreRoot(query)?.raw).toEqual(viaBody?.raw);
		expect(getPreRoot(headers)?.raw).toEqual(viaBody?.raw);
	});

	it('returns undefined for unknown objects and primitives', () => {
		expect(getPreRoot({ not: 'stamped' })).toBeUndefined();
		expect(getPreRoot('primitive')).toBeUndefined();
		expect(getPreRoot(null)).toBeUndefined();
	});

	it('primitive bodies are recorded but not correlatable', () => {
		feedPreRoot({ method: 'POST', url: '/p', body: 'raw-string-body' });
		expect(getPreRoot('raw-string-body')).toBeUndefined();
	});

	it('feedValidatedPreRoot attaches the DTO to the boundary record', () => {
		const body = { name: 'Alice' };
		feedPreRoot({ method: 'POST', url: '/v', body });
		const dto = { name: 'Alice', validated: true };
		feedValidatedPreRoot(body, dto);
		expect(getPreRoot(body)?.validated).toBe(dto);
	});

	it('feedValidatedPreRoot no-ops for unstamped objects and primitives', () => {
		expect(() => feedValidatedPreRoot('primitive', {})).not.toThrow();
		expect(() => feedValidatedPreRoot({ never: 'stamped' }, {})).not.toThrow();
	});
});

describe('feedPreRootFromRequest', () => {
	it('maps a structural request into the raw payload', () => {
		const body = { a: 1 };
		const req = {
			method  : 'PUT',
			url     : '/r',
			params  : { id: '7' },
			query   : {},
			body,
			headers : { h: 'v' },
		};
		feedPreRootFromRequest(req);

		const raw = getPreRoot(body)?.raw as Record<string, unknown>;
		expect(raw.method).toBe('PUT');
		expect(raw.url).toBe('/r');
		// storeRequest off (default): the request is neither linked nor stamped
		expect(raw.request).toBeUndefined();
		expect(getPreRoot(req)).toBeUndefined();
	});

	it('storeRequest links and stamps the request object', () => {
		const body = { b: 2 };
		const req = { method: 'GET', url: '/s', body };
		feedPreRootFromRequest(req, { storeRequest: true });

		const raw = getPreRoot(body)?.raw as Record<string, unknown>;
		expect(raw.request).toBe(req);
		// the request itself resolves — an error boundary holding only the
		// request can still report WHICH data caused the failure
		expect(getPreRoot(req)?.raw).toBe(raw);
	});
});
