const esbuild = require('esbuild');

const config = {
	entryPoints: ['src/main.ts'],
	bundle: true,
	outfile: 'build/webm-muxer.js',
	logLevel: 'info',
	watch: true,
	platform: 'node'
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