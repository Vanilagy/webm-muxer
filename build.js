const esbuild = require('esbuild');

esbuild.build({
	entryPoints: ['src/main.ts'],
	bundle: true,
	outfile: 'build/main.js',
	logLevel: 'info',
	watch: true
});