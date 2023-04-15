const esbuild = require('esbuild');

const config = {
	entryPoints: ['src/index.ts'],
	bundle: true,
	outfile: 'build/webm-muxer.js',
	logLevel: 'info',
	watch: true,
	format: 'iife',

	// The following are hacks to basically make this an UMD module. No native support for that in esbuild as of today
	globalName: 'WebMMuxer',

	// Object.assign(module.exports, WebMMuxer) would make us lose named exports in CJS-to-ESM interop
	footer: {
		js:
`if (typeof module === "object" && typeof module.exports === "object") {
	module.exports.Muxer = WebMMuxer.Muxer;
	module.exports.ArrayBufferTarget = WebMMuxer.ArrayBufferTarget;
	module.exports.StreamTarget = WebMMuxer.StreamTarget;
	module.exports.FileSystemWritableFileStreamTarget = WebMMuxer.FileSystemWritableFileStreamTarget;
}`
	}
};

esbuild.build({
	...config,
	outfile: 'build/webm-muxer.js'
});
esbuild.build({
	...config,
	outfile: 'build/webm-muxer.min.js',
	minify: true
});