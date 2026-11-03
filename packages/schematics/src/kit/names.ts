import { changeCase } from '@cpdevtools/ts-dev-utilities';

/** The forms of a name the templates use. */
export interface Names {
  /** As given. */
  readonly name: string;
  /** `cart-item-quantity` */
  readonly fileName: string;
  /** `CartItemQuantity` */
  readonly className: string;
  /** `cartItemQuantity` */
  readonly propertyName: string;
  /** `CART_ITEM_QUANTITY` */
  readonly constantName: string;
  /** `<prefix>-cart-item-quantity`, or the file name without a prefix. */
  readonly selector: string;
}

/** Kebab, Pascal, camel and constant forms of a name, and its selector. */
export function names(name: string, prefix?: string): Names {
  const fileName = changeCase.kebabCase(name);
  return {
    name,
    fileName,
    className: changeCase.pascalCase(name),
    propertyName: changeCase.camelCase(name),
    constantName: changeCase.constantCase(name),
    selector: prefix ? `${prefix}-${fileName}` : fileName,
  };
}
