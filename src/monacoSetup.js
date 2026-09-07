import { loader } from '@monaco-editor/react';

// Serve Monaco from this CaddyUI instance. This keeps the editor compatible
// with a self-only CSP and avoids making the control plane depend on a CDN.
loader.config({ paths: { vs: '/vendor/monaco/vs' } });
