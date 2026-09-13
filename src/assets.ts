/** Public asset URL that also works from a GitHub Pages project subfolder. */
export const publicAsset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
