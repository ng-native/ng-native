/**
 * The specifiers a test file mocks, read from its source: the pool resolves each to the module id
 * Metro gave it, since the app has no way to resolve a path to a module of its own.
 */

/** `vi.mock('x')`, `vi.mock(import('x'))`, and the rest of the family that names a module. */
const MOCK_CALL =
  /\bvi\.(?:mock|doMock|unmock|doUnmock|importActual|importMock)\(\s*(?:import\(\s*)?(['"`])([^'"`]+)\1/g;

export function mockedSpecifiers(source: string): string[] {
  return [...new Set([...source.matchAll(MOCK_CALL)].map((match) => match[2]!))];
}
