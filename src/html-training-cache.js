// Document content is fetched from the authorized server for each opening.
export function createContentCache() {
  return {get:()=>null,read:async()=>null,put:async()=>{}};
}
