const esbuild = require('esbuild');

const baseConfig = {
	entryPoints: ['src/index.ts'],
	bundle: true,
	outfile: 'build/webm-muxer.js',
	logLevel: 'info',
	watch: true
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