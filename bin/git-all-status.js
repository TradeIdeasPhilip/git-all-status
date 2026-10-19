#!/usr/bin/env node
// Lets `npm link` install a `git-all-status` command that runs the
// TypeScript source directly, from whatever directory you type it in.
import { register } from 'tsx/esm/api';

register();
await import('../src/index.ts');
