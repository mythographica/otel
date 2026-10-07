#!/usr/bin/env node
/**
 * Build start: remove exactly build/ and build-cjs/ so tsc output never
 * retains files of DELETED sources (tsc only overwrites, never removes —
 * without this, a deleted src/request-scope.ts would keep shipping in
 * build/request-scope.js). Nothing else is touched.
 */
import { rmSync } from 'node:fs';

rmSync('build', { recursive: true, force: true });
rmSync('build-cjs', { recursive: true, force: true });
