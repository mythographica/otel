#!/usr/bin/env node
/**
 * Publish gate: the committed build/ and build-cjs/ must equal what tsc
 * just produced.
 *
 * This repo TRACKS build/ + build-cjs/ in git, and `files` publishes them —
 * so the rule is "publish committed files": prepublishOnly rebuilds, and
 * this check fails the publish if the rebuild left the tree dirty (i.e.
 * someone changed src/ without committing the regenerated output).
 * Deterministic tsc output means a properly committed tree stays clean
 * through publish.
 *
 * Run by prepublishOnly, after build + tests.
 */
import { execSync } from 'node:child_process';

const dirty = execSync('git status --porcelain -- build/ build-cjs/', { encoding: 'utf8' }).trim();

if (dirty !== '') {
	console.error('');
	console.error('publish aborted: build/ or build-cjs/ changed when tsc ran.');
	console.error('The committed build output is stale — commit the regenerated output first:');
	console.error('');
	console.error('  npm run build && git add build/ build-cjs/ && git commit');
	console.error('');
	console.error(dirty);
	process.exit(1);
}
