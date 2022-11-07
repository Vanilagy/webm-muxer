const esbuild = require('esbuild');

const config = {
	entryPoints: ['src/main.ts'],
	bundle: true,
	outfile: 'build/webm-muxer.js',
	logLevel: 'info',
	watch: true,
	format: 'iife',
	// The following are hacks to basically make this an UMD module. No native support for that in esbuild as of today
	globalName: 'WebMMuxer',
	footer: {
		js: 'WebMMuxer = WebMMuxer.default;\nif (typeof module === "object" && typeof module.exports === "object") module.exports = WebMMuxer;'
	}
}

esbuild.build({
	...config,
	outfile: 'build/webm-muxer.js'
});
esbuild.build({
	...config,
	outfile: 'build/webm-muxer.min.js',
	minify: true
});