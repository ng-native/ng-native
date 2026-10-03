/** A product the parameter and layout pages list. */
export interface Product {
  readonly id: string;
  readonly name: string;
  readonly price: string;
  readonly colour: string;
}

export const PRODUCTS: readonly Product[] = [
  { id: 'aurora-lamp', name: 'Aurora lamp', price: '€89', colour: '#dd0330' },
  { id: 'tide-kettle', name: 'Tide kettle', price: '€64', colour: '#c30f2e' },
  { id: 'drift-chair', name: 'Drift chair', price: '€240', colour: '#8e1a2e' },
];

export function productById(id: string | null | undefined): Product | undefined {
  return PRODUCTS.find((product) => product.id === id);
}
