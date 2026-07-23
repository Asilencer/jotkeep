declare module 'turndown' {
  type Filter = string | string[] | ((node: Node) => boolean)

  type Options = {
    bulletListMarker?: string
    codeBlockStyle?: 'indented' | 'fenced'
    emDelimiter?: string
    headingStyle?: 'setext' | 'atx'
  }

  type Rule = {
    filter: Filter
    replacement: (content: string, node: Node) => string
  }

  export default class TurndownService {
    constructor(options?: Options)
    addRule(key: string, rule: Rule): this
    remove(filter: Filter): this
    turndown(input: string | Node): string
  }
}
