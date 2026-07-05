import * as esbuild from 'esbuild'

const pages = ['auth', 'coordinator', 'reporter', 'volunteers', 'resources', 'history']

await esbuild.build({
  entryPoints: pages.map(p => `src/${p}.js`),
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'es2020',
  platform: 'browser',
  sourcemap: false,
  minify: false,
  external: ['crypto'],
  define: {
    'process.env.INSFORGE_URL': JSON.stringify('https://pk5eng7w.ap-southeast.insforge.app'),
    'process.env.INSFORGE_ANON_KEY': JSON.stringify('anon_8cdce68be8188b489d5c12ad3b86adff9054b6599225e0f9dc950f611e7468a8'),
    'process.env.OPENROUTER_API_KEY': JSON.stringify(''),
  },
})

console.log('Build complete')
