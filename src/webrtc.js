/**
 * @superlexicon/sdk/webrtc
 *
 * Canonical subpath entrypoint re-exporting `./webrtc-call.js` so both `package.json` exports
 * and direct `packages/sdk/src/$1.js` bundler aliases resolve `@superlexicon/sdk/webrtc`.
 */
export * from './webrtc-call.js';
