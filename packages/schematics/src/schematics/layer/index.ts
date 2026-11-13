import { chain, SchematicsException, type Rule, type Tree } from '@angular-devkit/schematics';
import { isLayer, LAYERS } from '../../kit';
import { createEntryPoint, domainContext, format } from '../common';

export interface LayerOptions {
  domain: string;
  name: string;
}

export function layer(options: LayerOptions): Rule {
  return chain([
    (tree: Tree) => {
      if (!isLayer(options.name)) {
        throw new SchematicsException(
          `"${options.name}" is not a layer (${LAYERS.join(', ')}); for test doubles use \`ng g testing\`.`,
        );
      }
      createEntryPoint(tree, domainContext(tree, options.domain), options.name);
    },
    format(),
  ]);
}

export default layer;
