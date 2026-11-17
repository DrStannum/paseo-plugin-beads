// The daemon's esbuild loads .svg files as text (loader {".svg": "text"}).
declare module "*.svg" {
  const markup: string;
  export default markup;
}
