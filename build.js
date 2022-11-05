const esbuild = require('esbuild');

esbuild.build({
	entryPoints: ['src/main.ts'],
	bundle: true,
	outfile: 'build/webm-muxer.js',
	logLevel: 'info',
	watch: true
});

esbuild.build({
	entryPoints: ['src/main.ts'],
	bundle: true,
	outfile: 'build/webm-muxer.min.js',
	logLevel: 'info',
	watch: true,
	minify: true
});