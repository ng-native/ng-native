/** The prop an attribute is kept as: the engine has `id` as React Native's `nativeID`. */
export const propOf = (attribute: string) => (attribute === 'id' ? 'nativeID' : attribute);
