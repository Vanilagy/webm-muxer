const esbuild = require('esbuild');

esbuild.build({
	entryPoints: ['src/main.ts'],
	bundle: true,
	outfile: 'build/bundle.js',
	logLevel: 'info',
	watch: true
});