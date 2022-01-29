import { cur, idx, skip, err, expr } from 'subscript/parser.js'
import parseExpr from 'subscript/subscript.js'
import sube, { observable } from 'sube'
import { prop } from 'element-props'
import { NodeTemplatePart, TemplateInstance } from './template-parts.js'


export const processor = {
  createCallback(instance, allParts, init) {
    if (states.get(instance)) return

    let parts = {}, // parts by ids used in parts
        values = {}, // template values state
        observers = {}, // observable properties in state
        ready, value

    // detect prop → part
    for (const part of allParts) {
      (part.eval = parseExpr(part.expression)).args.map(arg => (parts[arg]||=[]).push(part))

      // apply directives
      directives[part.directive]?.create(instance, part, init)
    }

    // hook up observables
    // FIXME: we don't know all possible observables here, eg. item.text.
    // We instead must check when we set the value to a part - if that's observable, it must be initialized
    for (let k in init) {
      if (observable(value = init[k]))
        observers[k] = sube(value, v => (values[k] = v, ready && this.processCallback(instance, parts[k], {[k]: v}))),
        registry.register(value, [observers, k])
      else values[k] = value
    }

    // initial state inits all parts
    ready = true, states.set(instance, [values, observers])
  },

  // updates diff parts from current state
  processCallback(instance, parts, state) {
    let [values, observers] = states.get(instance), k, part, v

    for (k in state) if (!observers[k]) values[k] = state[k] // extend state ignoring reactive vals
    // Object.assign(values, state)
    for (part of parts)
      if ((v = part.eval(values)) !== part.value) {
        // regular node set - either attrib or node part
        if (part.replace) part.replace(v)

        else part.setter.parts.length === 1 ? prop(part.element, part.attributeName, part.value = v) : part.value = v
      }
  }
},

states = new WeakMap,

registry = new FinalizationRegistry(([obs, k]) => (obs[k]?.(), delete obs[k])),

directives = {},

directive = (dir, create) => directives[dir] = {
  prepare(el, els=el.querySelectorAll(`[\\:${dir}]`), holder, tpl, expr) {
    // replace all shortcuts with inner templates
    for (el of els) {
      el.replaceWith(holder=new Text)
      tpl = document.createElement('template')
      tpl.content.appendChild(el)
      tpl.setAttribute('directive', dir)
      expr = el.getAttribute(':'+dir)
      tpl.setAttribute('expression', expr.slice(expr.indexOf('{{')+2, expr.lastIndexOf('}}')))
      el.removeAttribute(':'+dir)
      holder.replaceWith(tpl)
    }
  },
  create
}

// extend default subscript
// '" strings with escaping characters
const BSLASH = 92,
  escape = {n:'\n', r:'\r', t:'\t', b:'\b', f:'\f', v:'\v'},
  string = q => (qc, c, str='') => {
    while (c=cur.charCodeAt(idx), c-q) {
      if (c === BSLASH) skip(), c=skip(), str += escape[c] || c
      else str += skip()
    }
    return skip()||err('Bad string'), () => str
  }
parseExpr.set('"', string(34))
parseExpr.set("'", string(39))

// ?:
parseExpr.set(':', 3.1, (a,b) => [a,b])
parseExpr.set('?', 3, (a,b) => a ? b[0] : b[1])

// literals
parseExpr.set('true', a => { if (a) throw new SyntaxError('Unexpected'); return ()=>true })
parseExpr.set('false', a => { if (a) throw new SyntaxError('Unexpected'); return ()=>false })

// a?.b - optional chain operator
parseExpr.set('?.',18, (a,b,aid,bid) => a?.[bid])

// a | b - pipe overload
parseExpr.set('|', 6, (a,b) => b(a))

// a in b operator for loops
parseExpr.set('in', (a,b) => (b = expr(), ctx => [a.id(ctx), b(ctx)]))


// configure directives
directive('if', (instance, part) => {
  // clauses in evaluation read detected clause by :if part and check if that's them
  (part.addCase = (casePart, matches=casePart.eval) => (
    casePart.eval = state => part.match ? '' : !matches(state) ? '' : (
      part.match = casePart, // flag found case
      // FIXME: create on the first match and only update after; complicated by instance losing children on update
      new TemplateInstance(casePart.template, state, processor)
    )
  ))(instance.ifPart=part)

  // `if` case goes first, so we clean up last matched case and detect match over again
  const evalCase = part.eval
  part.eval = state => (part.match = null, evalCase(state))
})
directive('else-if', (instance, part) => instance.ifPart?.addCase(part))
directive('else', (instance, part) => (part.eval=()=>true, instance.ifPart?.addCase(part), instance.ifPart=null) )

directive('each', (instance, part) => {
  let evalLoop = part.eval
  part.eval = state => {
    const [itemId, items] = evalLoop(state)
    // FIXME: cache instances instead of recreating. Causes difficulties tracking instance children
    return items.map(item => new TemplateInstance(part.template, {item, ...state}, processor))
  }
})


export default processor
