export const validStoryId = (id: string) => /^[1-9][0-9]{0,14}$/.test(id);

export const PUBLIC_CACHE_CONTROL = "public, max-age=0, s-maxage=300";
