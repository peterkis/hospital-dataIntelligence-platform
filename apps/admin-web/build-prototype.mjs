import { build } from 'vite';

process.env.VITE_ADMIN_MODE = 'prototype';
await build({ mode: 'prototype' });
