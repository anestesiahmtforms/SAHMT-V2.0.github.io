/** Give each built HTML/asset set a separate installed cache. */
export function stampShellRelease(source, release) {
  if (!/^[1-9]\d{0,15}$/.test(String(release))) throw new Error('SHELL_RELEASE_INVALID');
  const declaration = /^const CACHE = 'sahmt-v2-shell-v\d+';/m;
  if (!declaration.test(source)) throw new Error('SHELL_CACHE_DECLARATION_MISSING');
  return source.replace(declaration, `const CACHE = 'sahmt-v2-shell-v${release}';`);
}
