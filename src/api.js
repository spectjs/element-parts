// minimal Template Instance API surface
// https://github.com/WICG/webcomponents/blob/gh-pages/proposals/Template-Instantiation.md#32-template-parts-and-custom-template-process-callback
import updateNodes from 'swapdom'
import { parse } from './parse.js'

const FRAGMENT = 11

const values = {
  processCallback(instance, parts, state) {
    if (!state) return
    for (const part of parts) if (part.expression in state) part.value = state[part.expression]
  }
}

export class TemplateInstance extends DocumentFragment {
  #parts
  #processor
  constructor(template, params, processor=values) {
    super()
    this.appendChild(template.content.cloneNode(true))
    this.#parts = parse(this)
    this.#processor = processor
    params ||= {}
    processor.createCallback?.(this, this.#parts, params)
    processor.processCallback(this, this.#parts, params)
  }
  update(params) { this.#processor.processCallback(this, this.#parts, params) }
}

export class TemplatePart {
  constructor(setter, expr) { this.setter = setter, this.expression = expr }
  toString() { return this.value; }
}

export class AttributeTemplatePart extends TemplatePart {
  #value = '';
  get attributeName() { return this.setter.attr.name; }
  get attributeNamespace() { return this.setter.attr.namespaceURI; }
  get element() { return this.setter.element; }
  get value() { return this.#value; }
  set value(newValue) {
    if (this.#value === newValue) return // save unnecessary call
    this.#value = newValue
    const { attr, element, parts } = this.setter;
    if (parts.length === 1) { // fully templatized
      if (newValue == null) element.removeAttributeNS(attr.namespaceURI, attr.name);
      else element.setAttributeNS(attr.namespaceURI, attr.name, newValue);
    } else element.setAttributeNS(attr.namespaceURI, attr.name, parts.join(''));
  }
  get booleanValue() {
    this.setter.element.hasAttribute(this.setter.attr.name);
  }
  set booleanValue(value) {
    if (this.setter.parts.length === 1) this.value = value ? '' : null;
    else throw new DOMException('Value is not fully templatized');
  }
}

export class NodeTemplatePart extends TemplatePart {
  #nodes = [new Text]
  get replacementNodes() { return this.#nodes }
  get parentNode() { return this.setter.parentNode; }
  get nextSibling() { return this.#nodes[this.#nodes.length-1].nextSibling; }
  get previousSibling() { return this.#nodes[0].previousSibling; }
  // FIXME: not sure why do we need string serialization here? Just because parent class has type DOMString?
  get value() { return this.#nodes.map(node=>node.textContent).join(''); }
  set value(newValue) { this.replace(newValue) }
  replace(...nodes) { // replace current nodes with new nodes.
    nodes = nodes.length ? nodes
      .flat()
      .flatMap(node =>
        node?.forEach ? [...node] :
        node?.nodeType === FRAGMENT ? [...node.childNodes] :
        node?.nodeType ? [node] :
        [new Text(node == null ? '' : node)]
      )
    : [new Text]
    this.#nodes = updateNodes(this.parentNode, this.#nodes, nodes, this.nextSibling)
  }
  replaceHTML(html) {
    const fragment = this.parentNode.cloneNode()
    fragment.innerHTML = html;
    this.replace(fragment.childNodes);
  }
}

export class InnerTemplatePart extends NodeTemplatePart {
  directive
  constructor(setter, template) {
    let directive = template.getAttribute('directive') || template.getAttribute('type'),
        expression = template.getAttribute('expression') || template.getAttribute(directive) || ''
    if (expression.startsWith('{{')) expression = expression.trim().slice(2,-2).trim()
    super(setter, expression)
    this.template = template
    this.directive = directive
  }
}
