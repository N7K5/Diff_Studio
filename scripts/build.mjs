import {build} from 'esbuild';
import {mkdir, cp, readdir, rm} from 'node:fs/promises';
await mkdir('dist', {recursive:true});
for(const file of await readdir('dist'))if(file.endsWith('.ttf'))await rm(`dist/${file}`);
await Promise.all([
  build({entryPoints:['src/extension.ts'],bundle:true,platform:'node',format:'cjs',external:['vscode'],outfile:'dist/extension.cjs',sourcemap:true}),
  build({entryPoints:['webview/main.ts'],bundle:true,platform:'browser',format:'iife',outfile:'dist/webview.js',loader:{'.ttf':'file'},minify:true}),
  build({entryPoints:['node_modules/monaco-editor/esm/vs/editor/editor.worker.js'],bundle:true,format:'iife',outfile:'dist/editor.worker.js',minify:true}),
  build({entryPoints:['node_modules/monaco-editor/esm/vs/language/json/json.worker.js'],bundle:true,format:'iife',outfile:'dist/json.worker.js',minify:true}),
  build({entryPoints:['node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js'],bundle:true,format:'iife',outfile:'dist/ts.worker.js',minify:true}),
  cp('webview/style.css','dist/style.css')
]);
