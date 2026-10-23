// Only the flag we read; avoids a dependency on Vite's types here.
interface ImportMetaEnv {
  readonly DEV: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module "*.mp3" {
  const url: string;
  export default url;
}
