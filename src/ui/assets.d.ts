// Vite が画像をビルドに含め、配信先のパスを返す
declare module '*.webp' {
  const url: string;
  export default url;
}
