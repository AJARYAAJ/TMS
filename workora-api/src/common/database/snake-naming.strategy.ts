import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  tableName(className: string, customName?: string) {
    return customName ?? snake(className);
  }
  columnName(propertyName: string, customName: string | undefined, prefixes: string[]) {
    return snake(prefixes.concat(customName ?? propertyName).join('_'));
  }
  relationName(propertyName: string) {
    return snake(propertyName);
  }
  joinColumnName(relationName: string, referencedColumnName: string) {
    return snake(`${relationName}_${referencedColumnName}`);
  }
}
