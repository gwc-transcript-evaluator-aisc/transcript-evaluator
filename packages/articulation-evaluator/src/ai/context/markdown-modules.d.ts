/** Lets TypeScript (and esbuild, via the `.md` -> `text` loader configured in
 * lib/articulation-evaluator-stack.ts) treat a `.md` import as its raw file contents. */
declare module '*.md' {
  const content: string;
  export default content;
}
