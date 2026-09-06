import { describe, it, expect } from 'vitest';
import { define, getProps } from 'mnemonica/module';
import { isMnemonicaInstance } from '../src/utils/is-mnemonica-instance.js';

describe('isMnemonicaInstance', () => {
	it('returns true for mnemonica instances', () => {
		const MyType = define('TestType', function (this: { x: number }, val: number) {
			this.x = val;
		});
		const instance = new MyType(42);
		expect(isMnemonicaInstance(instance)).toBe(true);
	});

	it('returns false for plain objects', () => {
		expect(isMnemonicaInstance({})).toBe(false);
		expect(isMnemonicaInstance({ x: 42 })).toBe(false);
	});

	it('returns false for null/undefined', () => {
		expect(isMnemonicaInstance(null)).toBe(false);
		expect(isMnemonicaInstance(undefined)).toBe(false);
	});

	it('returns false for primitives', () => {
		expect(isMnemonicaInstance(42)).toBe(false);
		expect(isMnemonicaInstance('hello')).toBe(false);
	});

	it('returns false for class instances', () => {
		class Foo {
			x = 42;
		}
		expect(isMnemonicaInstance(new Foo())).toBe(false);
	});
});
