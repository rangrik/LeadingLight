// Scripts the plugin runs on boxes are bundled as text.
declare module "*.py" {
  const source: string;
  export default source;
}
