// Safe arithmetic evaluator for the calculator (no eval). Grammar:
//   expr   := term (('+' | '-') term)*
//   term   := power (('*' | '/' | '%') power)*      '%' is remainder
//   power  := unary ('^' power)?                     right-associative
//   unary  := ('-' | '+') unary | postfix
//   postfix:= primary ('%')?                          trailing % = percent (x/100)
//   primary:= number | '(' expr ')' | 'sqrt' '(' expr ')'
export class CalcError extends Error {}

function tokenize(src) {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/√/g, 'sqrt');
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) { tokens.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    if (s.startsWith('sqrt', i)) { tokens.push({ t: 'sqrt' }); i += 4; continue; }
    if ('+-*/%^()'.includes(c)) { tokens.push({ t: c }); i++; continue; }
    throw new CalcError(`Unexpected “${c}”`);
  }
  return tokens;
}

export function evaluate(src) {
  const tokens = tokenize(String(src));
  if (!tokens.length) throw new CalcError('Empty');
  let pos = 0;
  const peek = () => tokens[pos]?.t;
  const take = (t) => { if (peek() !== t) throw new CalcError(t === ')' ? 'Missing )' : 'Incomplete expression'); pos++; };

  function primary() {
    const tok = tokens[pos];
    if (!tok) throw new CalcError('Incomplete expression');
    if (tok.t === 'num') { pos++; return tok.v; }
    if (tok.t === '(') { pos++; const v = expr(); take(')'); return v; }
    if (tok.t === 'sqrt') {
      pos++; take('(');
      const v = expr(); take(')');
      if (v < 0) throw new CalcError('Square root of a negative number');
      return Math.sqrt(v);
    }
    throw new CalcError('Incomplete expression');
  }
  function postfix() {
    let v = primary();
    // "50%" means 0.5, unless the % is a remainder operator followed by an operand.
    while (peek() === '%' && !['num', '(', 'sqrt', '-', '+'].includes(tokens[pos + 1]?.t)) { pos++; v /= 100; }
    return v;
  }
  function unary() {
    if (peek() === '-') { pos++; return -unary(); }
    if (peek() === '+') { pos++; return unary(); }
    return postfix();
  }
  function power() {
    const base = unary();
    if (peek() === '^') { pos++; return base ** power(); }
    return base;
  }
  function term() {
    let v = power();
    while (['*', '/', '%'].includes(peek())) {
      const op = tokens[pos++].t;
      const r = power();
      if ((op === '/' || op === '%') && r === 0) throw new CalcError('Cannot divide by zero');
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') v = tokens[pos++].t === '+' ? v + term() : v - term();
    return v;
  }

  const result = expr();
  if (pos < tokens.length) throw new CalcError(tokens[pos].t === ')' ? 'Unmatched )' : 'Unexpected input');
  if (!Number.isFinite(result)) throw new CalcError('Result is too large');
  return result;
}

// Hides floating-point noise (0.1 + 0.2 -> 0.3) and uses exponent form for extremes.
export function format(n) {
  if (Object.is(n, -0)) return '0';
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return n.toExponential(8).replace(/\.?0+e/, 'e');
  return String(Number(n.toPrecision(12)));
}
