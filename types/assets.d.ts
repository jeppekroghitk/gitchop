/** dev/bundle.mjs loads a stylesheet imported by a module as its text. */
declare module '*.css' {
  const text: string;
  export default text;
}
