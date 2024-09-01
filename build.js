const esbuild = require('esbuild');

let baseConfig = {
	entryPoints: ['src/index.ts'],
	bundle: true,
	logLevel: 'info',
	watch: process.argv[2] === '--watch',
};

const umdConfig = {
	...baseConfig,
	format: 'iife',

	// The following are hacks to basically make this an UMD module. No native support for that in esbuild as of today
	globalName: 'WebMMuxer',

	footer: {
		js:
`if (typeof module === "object" && typeof module.exports === "object") Object.assign(module.exports, WebMMuxer)`
	}
};

const esmConfig = {
	...baseConfig,
	format: 'esm'
};

esbuild.build({
	...umdConfig,
	outfile: 'build/webm-muxer.js'
});
esbuild.build({
	...umdConfig,
	outfile: 'build/webm-muxer.min.js',
	minify: true
});

esbuild.build({
	...esmConfig,
	outfile: 'build/webm-muxer.mjs'
});
esbuild.build({
	...esmConfig,
	outfile: 'build/webm-muxer.min.mjs',
	minify: true
});